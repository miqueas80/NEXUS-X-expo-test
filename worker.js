const DEFAULT_ALLOWED_ORIGINS = ['https://miqueas80.github.io'];
const MAX_CHAT_BODY_BYTES = 3 * 1024 * 1024;
const MAX_MESSAGES = 12;
const MAX_TEXT_PART_CHARS = 16000;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });
}

function allowedOrigins() { return new Set(DEFAULT_ALLOWED_ORIGINS); }

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Vary': 'Origin',
    'Cache-Control': 'no-store'
  };
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') {
    return content.slice(0, MAX_TEXT_PART_CHARS);
  }
  if (!Array.isArray(content)) return '';
  return content.slice(0, 8).map(part => {
    if (!part || typeof part !== 'object') return null;
    if (part.type === 'text') {
      return { type: 'text', text: String(part.text || '').slice(0, MAX_TEXT_PART_CHARS) };
    }
    if (part.type === 'image_url') {
      const url = String(part.image_url?.url || '');
      if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) return null;
      return { type: 'image_url', image_url: { url } };
    }
    return null;
  }).filter(Boolean);
}

function sanitizeChatPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('JSON inválido');
  }
  const model = String(input.model || '').trim();
  if (!model || model.length > 200) throw new Error('Modelo inválido');
  if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > MAX_MESSAGES) {
    throw new Error('Mensajes inválidos');
  }
  const messages = input.messages.map(message => {
    const role = ['system', 'user', 'assistant'].includes(message?.role) ? message.role : 'user';
    const content = normalizeMessageContent(message?.content);
    if ((typeof content === 'string' && !content) || (Array.isArray(content) && !content.length)) {
      throw new Error('Contenido vacío');
    }
    return { role, content };
  });
  const payload = { model, messages };
  if (Number.isFinite(Number(input.temperature))) {
    payload.temperature = Math.max(0, Math.min(2, Number(input.temperature)));
  }
  if (Number.isFinite(Number(input.max_tokens))) {
    payload.max_tokens = Math.max(1, Math.min(4096, Math.round(Number(input.max_tokens))));
  }
  return payload;
}

async function enforceRateLimit(request, env, route) {
  if (!env.NEXUS_RATE_LIMITER?.limit) {
    return { ok: true };
  }
  const actor = request.headers.get('CF-Connecting-IP') || 'unknown';
  let success;
  try{({success}=await env.NEXUS_RATE_LIMITER.limit({key:`${route}:${actor}`}))}
  catch{return {ok:false,response:json({error:'Rate limiter no disponible'},503)}}
  if (!success) {
    return {
      ok: false,
      response: json(
        { error: 'Demasiadas solicitudes. Reintentá en unos segundos.' },
        429,
        { 'Retry-After': '60' }
      )
    };
  }
  return { ok: true };
}

async function boundedBody(request){
 const reader=request.body?.getReader();if(!reader)return '';
 const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_CHAT_BODY_BYTES){await reader.cancel();throw Object.assign(new Error('size'),{status:413})}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return new TextDecoder().decode(bytes);
}
async function upstreamRequest(url,options){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
 try{const upstream=await fetch(url,{...options,signal:controller.signal});const body=await upstream.text();return {upstream,body}}finally{clearTimeout(timer)}
}
function upstreamFailure(response,cors,body='',model='',secret=''){
 const headers={...cors};const retry=response.headers.get('Retry-After');if(retry&&/^(\d+|[A-Za-z]{3},[ -~]{1,80})$/.test(retry))headers['Retry-After']=retry;
 if(response.status===429&&!headers['Retry-After'])headers['Retry-After']='60';
 let data={};try{data=JSON.parse(body)}catch{}
 const rawMessage=String(data?.error?.message||'');
 const modelAuth=response.status===401&&/^User not found\.?$/i.test(rawMessage.trim())&&(!secret||!rawMessage.includes(secret));
 const blocked=Number(data.error_code)===1010||response.status===403&&/error\s*(?:code\s*)?1010/i.test(body.slice(0,16384));
 const kind=blocked?'cloudflare_block':modelAuth?'model_auth':[401,403].includes(response.status)?'authentication':response.status===429?'rate_limit':response.status===503?'model_unavailable':'upstream';
 const rayId=String(data.ray_id||response.headers.get('CF-Ray')||'').replace(/[^A-Za-z0-9-]/g,'').slice(0,80);
 const safeModel=/^[A-Za-z0-9_.:/-]{1,200}$/.test(model)&&(!secret||!model.includes(secret))?model:'';
 const detail={kind,message:modelAuth?'User not found.':blocked?'Cloudflare Error 1010':'Proveedor externo no disponible',code:modelAuth?'authentication_error':blocked?'1010':kind,model:safeModel,rayId:secret&&rayId.includes(secret)?'':rayId,domain:'api.xkiro.com'};
 return json({error:{message:'Proveedor externo no disponible',detail},status:response.status},response.status,headers);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const origins = allowedOrigins(env);
    const protectedRoute = ['/health','/models','/chat/completions'].includes(url.pathname);
    if(origin&&!origins.has(origin))return json({error:'Origin no permitido'},403);
    if(url.pathname==='/health'&&request.method!=='GET'&&request.method!=='OPTIONS')return json({error:'Método no permitido'},405,origin?corsHeaders(origin):{});

    if (url.pathname === '/health' && request.method === 'GET') {
      const healthCors = origin && origins.has(origin) ? corsHeaders(origin) : { 'Cache-Control': 'no-store' };
      return json({
        ok: true,
        service: 'NEXUS-X xKiro Gateway',
        rateLimiterConfigured: Boolean(env.NEXUS_RATE_LIMITER?.limit)
      }, 200, healthCors);
    }

    if (protectedRoute) {
      if (url.pathname!=='/health'&&(!origin || !origins.has(origin))) {
        return json({ error: 'Origin no permitido' }, 403);
      }
    }

    const cors = origin && origins.has(origin) ? corsHeaders(origin) : {};

    if (request.method === 'OPTIONS') {
      if (!protectedRoute || !origin || !origins.has(origin)) {
        return json({ error: 'Preflight no permitido' }, 403, cors);
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/models') {
      if (request.method !== 'GET') return json({ error: 'Método no permitido' }, 405, cors);
      const limited = await enforceRateLimit(request, env, 'models');
      if (!limited.ok) {
        for(const [key,value] of Object.entries(cors))limited.response.headers.set(key,value);
        return limited.response;
      }
      try {
        const {upstream,body} = await upstreamRequest('https://api.xkiro.com/v1/models', {
          headers: { 'Accept': 'application/json' }
        });
        if(!upstream.ok)return upstreamFailure(upstream,cors,body);
        return new Response(body, {
          status: upstream.status,
          headers: {
            ...cors,
            'Content-Type': upstream.headers.get('Content-Type') || 'application/json'
          }
        });
      } catch (error) {
        return json({ error: 'Gateway upstream no disponible' }, error?.name==='AbortError'?504:502, cors);
      }
    }

    if (url.pathname === '/chat/completions') {
      if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors);
      if (!env.XKIRO_API_KEY) return json({ error: 'XKIRO_API_KEY no configurada' }, 503, cors);
      const contentType = request.headers.get('Content-Type') || '';
      if (contentType.split(';')[0].trim().toLowerCase()!=='application/json') {
        return json({ error: 'Content-Type debe ser application/json' }, 415, cors);
      }
      const declaredLength = Number(request.headers.get('Content-Length') || 0);
      if (declaredLength > MAX_CHAT_BODY_BYTES) {
        return json({ error: 'Solicitud demasiado grande' }, 413, cors);
      }
      const limited = await enforceRateLimit(request, env, 'chat');
      if (!limited.ok) {
        for(const [key,value] of Object.entries(cors))limited.response.headers.set(key,value);
        return limited.response;
      }

      try {
        const raw = await boundedBody(request);
        if (new TextEncoder().encode(raw).byteLength > MAX_CHAT_BODY_BYTES) {
          return json({ error: 'Solicitud demasiado grande' }, 413, cors);
        }
        const payload = sanitizeChatPayload(JSON.parse(raw));
        const {upstream,body:responseBody} = await upstreamRequest('https://api.xkiro.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + env.XKIRO_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        if(!upstream.ok)return upstreamFailure(upstream,cors,responseBody,payload.model,env.XKIRO_API_KEY);
        if(responseBody.includes(env.XKIRO_API_KEY))return json({error:'Respuesta upstream inválida'},502,cors);
        return new Response(responseBody, {
          status: upstream.status,
          headers: {
            ...cors,
            'Content-Type': upstream.headers.get('Content-Type') || 'application/json'
          }
        });
      } catch (error) {
        const message = String(error?.message || error);
        if(error?.status===413)return json({error:'Solicitud demasiado grande'},413,cors);
        const clientError = error instanceof SyntaxError || /JSON|Modelo|Mensajes|Contenido/.test(message);
        return json(
          { error: clientError ? 'Solicitud inválida' : 'Gateway upstream no disponible' },
          clientError ? 400 : error?.name==='AbortError'?504:502,
          cors
        );
      }
    }

    return json({ error: 'Ruta no encontrada' }, 404, cors);
  }
};
