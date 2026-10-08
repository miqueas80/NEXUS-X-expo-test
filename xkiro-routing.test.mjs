import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from './worker.js';
import {harness,master,root} from './harness.mjs';
const ling='inclusionai/ling-3.0-flash-sante:free',good='mistralai/ministral-14b';
const app=fs.readFileSync(new URL('app.js',root),'utf8');
const ids=[ling,good,ling,'unverified'];
const catalog=()=>Response.json({data:ids.map(id=>({id,access_tier:'free',capabilities:{vision:true}}))});
const ok=(content='Una respuesta útil.')=>Response.json({choices:[{message:{content}}]});
const auth=message=>Response.json({error:{message,type:'authentication_error',code:'authentication_error'}},{status:401,headers:{'CF-Ray':'abc123-EZE'}});
const seeded=(mode='text',id=ling)=>app.replace("const xkiroGoodModels=readJsonStorage(XKIRO_GOOD_MODEL_KEY,{});",`const xkiroGoodModels=${JSON.stringify({[mode]:{id,at:Date.now()}})};`);

for(const mode of ['text','vision'])test(`${mode}: 401 User not found degrada una vez a modelo verificado y recuerda éxito`,async()=>{
 const attempted=[];const h=harness({source:seeded(mode),fetcher:(url,options)=>{
  if(!options?.body)return catalog();const p=JSON.parse(options.body);attempted.push(p.model);
  return p.model===ling?auth('User not found.'):ok(mode==='vision'?'{"category":"objeto rojo","confidence":0.8}':'Hola, puedo ayudarte.');
 }});
 try{h.api.state.web=true;const generate=()=>mode==='vision'?h.api.xkiroVisionAnalyze({imageDataUrl:'data:image/png;base64,YQ=='}):h.api.xkiroGenerate({question:'Hola'});
  const out=await generate();assert.equal(out.model,good);assert.deepEqual(attempted,[ling,good]);
  assert.equal(h.api.health.xkiro.authenticated,true);assert.equal(h.api.health.xkiro.lastError.status,401);assert.equal(h.api.health.xkiro.lastError.model,ling);assert.equal(h.api.health.xkiro.lastError.message,'User not found.');assert.equal(h.api.health.xkiro.lastError.rayId,'abc123-EZE');
  await generate();assert.deepEqual(attempted,[ling,good,good]);
  const remembered=JSON.parse(h.window.localStorage.getItem('nexus_xkiro_good_models_v1'));assert.equal(remembered[mode].id,good);
 }finally{h.close()}
});

test('sin historial prioriza Ministral comprobado; caché válida sobrevive a otra sesión',async()=>{
 let h=harness({fetcher:(url,options)=>options?.body?ok():catalog()});
 let saved;try{h.api.state.web=true;assert.equal((await h.api.xkiroGenerate({question:'hola'})).model,good);saved=h.window.localStorage.getItem('nexus_xkiro_good_models_v1')}finally{h.close()}
 h=harness({source:app.replace("const xkiroGoodModels=readJsonStorage(XKIRO_GOOD_MODEL_KEY,{});",`const xkiroGoodModels=${saved};`)});
 try{assert.equal(h.api.orderXKiroCandidates(ids.map(id=>({id})))[0].id,good);assert.equal(h.api.orderXKiroCandidates(ids.map(id=>({id}))).length,3)}finally{h.close()}
});

test('401 específicos agotados no prueban modelos desconocidos ni vuelven al fallido',async()=>{
 const attempted=[];const h=harness({source:seeded(),fetcher:(url,options)=>{if(!options?.body)return catalog();attempted.push(JSON.parse(options.body).model);return auth('User not found.')}});
 try{h.api.state.web=true;await assert.rejects(h.api.xkiroGenerate({question:'hola'}));assert.deepEqual(attempted,[ling,good]);assert.equal(h.api.health.xkiro.failures.length,2)}finally{h.close()}
});

for(const message of ['Invalid API key','Missing ClientApiKey','Unauthorized','User not found. sk-do-not-leak'])test(`autenticación general detiene fallback y sanitiza: ${message.split(' ')[0]}`,async()=>{
 const attempted=[];const h=harness({fetcher:(url,options)=>{if(!options?.body)return catalog();attempted.push(JSON.parse(options.body).model);return auth(message)}});
 try{h.api.state.web=true;await assert.rejects(h.api.xkiroGenerate({question:'hola'}));assert.deepEqual(attempted,[good]);assert.equal(h.api.health.xkiro.lastError.kind,'authentication');assert.doesNotMatch(JSON.stringify(h.api.health.xkiro),/sk-do-not-leak|Invalid API key|Missing ClientApiKey/)}finally{h.close()}
});

test('Cloudflare 1010 conserva dominio/Ray y no reintenta ni invalida clave',async()=>{
 const attempted=[];const h=harness({fetcher:(url,options)=>{if(!options?.body)return catalog();attempted.push(JSON.parse(options.body).model);return Response.json({error_code:1010,ray_id:'ray1010-EZE',zone:'nexus-xkiro-gateway.proyectomj11.workers.dev',detail:'secret raw'},{status:403})}});
 try{h.api.state.web=true;await assert.rejects(h.api.xkiroVisionAnalyze({imageDataUrl:'data:image/png;base64,YQ=='}));assert.deepEqual(attempted,[good]);assert.equal(h.api.health.xkiro.lastError.kind,'cloudflare_block');assert.equal(h.api.health.xkiro.lastError.rayId,'ray1010-EZE');assert.equal(h.api.health.xkiro.lastError.domain,'nexus-xkiro-gateway.proyectomj11.workers.dev');assert.doesNotMatch(JSON.stringify(h.api.health.xkiro),/secret raw/)}finally{h.close()}
});

test('Worker conserva 401 específico y modelo sin exponer secretos ni errores arbitrarios',async()=>{
 const original=globalThis.fetch;const key='private-worker-secret';
 const request=model=>new Request('https://gateway.example/chat/completions',{method:'POST',headers:{Origin:'https://miqueas80.github.io','Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:'Hola'}]})});
 try{globalThis.fetch=async()=>auth('User not found.');let r=await worker.fetch(request(ling),{XKIRO_API_KEY:key});assert.equal(r.status,401);let body=await r.json();assert.equal(body.error.detail.kind,'model_auth');assert.equal(body.error.detail.model,ling);assert.equal(body.error.detail.rayId,'abc123-EZE');
  globalThis.fetch=async()=>auth('Invalid '+key);r=await worker.fetch(request(key),{XKIRO_API_KEY:key});const raw=await r.text();assert.doesNotMatch(raw,/private-worker-secret/);assert.equal(JSON.parse(raw).error.detail.kind,'authentication');
 }finally{globalThis.fetch=original}
});

test('1010 HTML y formato sanitizado del Worker detienen fallback',async()=>{
 for(const body of ['<html><h1>Error 1010</h1>secret raw</html>',JSON.stringify({error:{detail:{kind:'cloudflare_block',message:'Cloudflare Error 1010',rayId:'upstream-Ray',domain:'api.xkiro.com'}}})]){
  let count=0;const h=harness({fetcher:(url,options)=>{if(!options?.body)return catalog();count++;return new Response(body,{status:403,headers:{'CF-Ray':'edge-Ray'}})}});
  try{h.api.state.web=true;await assert.rejects(h.api.xkiroGenerate({question:'hola'}));assert.equal(count,1);assert.equal(h.api.health.xkiro.lastError.kind,'cloudflare_block');assert.doesNotMatch(JSON.stringify(h.api.health.xkiro),/secret raw/)}finally{h.close()}
 }
});

test('voz convierte errores técnicos en un aviso corto, conserva resultado local y descarta eco final',async()=>{
 const h=harness({stored:master.records,online:false});let callbacks,last,count=0;
 try{await h.api.loadMaster();h.window.NexusOffline={diagnostics:{voice:{}},nativeVoice:async()=>null,cacheStatus:async()=>({ready:true}),createVoice:o=>{callbacks=o;return {start:async()=>{},stop(){}}}};h.window.navigator.mediaDevices={getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})};
  h.window.SpeechSynthesisUtterance=class{constructor(text){this.text=text}};h.window.speechSynthesis={getVoices:()=>[],cancel(){},speak:u=>{last=u;count++}};
  await h.api.startVoiceRecognition();const spoken=h.api.speechTextForTTS('LOCAL · Abrí inventario.\n\nEXTERNA NO DISPONIBLE · HTTP 401 User not found. Ray ID abc');assert.match(spoken,/Abrí inventario/);assert.doesNotMatch(spoken,/HTTP|401|User not found|Ray ID/);
  h.api.speakText(spoken);last.onend();await callbacks.onTranscript(last.text);await callbacks.onTranscript(last.text);assert.equal(count,1);
  await callbacks.onTranscript('Nexus abrí inventario');assert.equal(h.api.state.view,'inventory');assert.equal(count,2);
 }finally{h.api.stopVoiceRecognition();h.close()}
});

test('offline con Internet activado no consulta proveedor y NEXUS IA conserva inventario',async()=>{
 const h=harness({stored:master.records,online:false,fetcher:()=>{throw new Error('No debería salir a red')}});
 try{await h.api.loadMaster();h.api.state.web=true;const before=h.calls.length;const out=await h.api.nexusAgentTurn('Nexus abrí inventario y buscá ácido nítrico');assert.equal(out.actions[0].result.ok,true);assert.equal(h.api.state.inventory.length,111);assert.equal(h.calls.length,before);await assert.rejects(h.api.xkiroGenerate({question:'hola'}));assert.equal(h.calls.length,before)}finally{h.close()}
});
