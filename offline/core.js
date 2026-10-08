/* NEXUS local engines. No agent, network inference or inventory writes here. */
(function (root) {
 'use strict';
 const base = new URL('./', document.currentScript.src);
 const referenceDBName='nexus-visual-references-v1'+(new URL('../',base).pathname==='/NEXUS-X-expo-test/'?':expo-test':'');
 const manifest = root.NEXUS_OFFLINE_ASSETS;
 const cacheName = 'nexus-x-models:' + encodeURIComponent(new URL('../',base).pathname) + ':' + manifest.version;
 const assetURL = path => new URL(path,base).href;
 const diagnostics = {voice:{engine:'sin iniciar',local:true,language:'es',model:'vosk-small-es-0.42',microphone:'sin comprobar',wakeWord:'Nexus'},
  lens:{runtime:'sin iniciar',webgpu:!!navigator.gpu,wasm:typeof WebAssembly!=='undefined',model:'MobileCLIP-S0',detector:'MobileCLIP-S0',embedding:'sin iniciar',ocr:'PP-OCRv6 Tiny · no preparado',ocrDetector:'PP-OCRv6_tiny_det',ocrRecognizer:'PP-OCRv6_tiny_rec',ocrBackend:'sin iniciar',ocrCached:false,ocrDurationMs:0,ocrLines:0,cache:false}};
 const notify = (part,patch) => { Object.assign(diagnostics[part],patch); root.dispatchEvent(new CustomEvent('nexus-offline-status',{detail:{part,...diagnostics[part]}})); };
 const scripts = new Map();
 function loadScript(path,globalName) {
  if (root[globalName]) return Promise.resolve(root[globalName]);
  if (!scripts.has(path)) scripts.set(path,new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src=assetURL(path);
   script.onload=()=>root[globalName]?resolve(root[globalName]):reject(new Error('Runtime local inválido'));
   script.onerror=()=>{script.remove();scripts.delete(path);reject(new Error('Runtime no disponible. Prepará los modelos offline.'));};document.head.append(script);
  }));return scripts.get(path);
 }
 function groupAssets(group) { return manifest.files.filter(f=>!group||f.group===group); }
 async function cacheStatus(group) {
  if (!root.caches) return {ready:false,missing:['Cache Storage no disponible']};
  const cache=await caches.open(cacheName),missing=[];
  for (const f of groupAssets(group)) {
   const response=await cache.match(assetURL(f.path));
   if (!response || response.headers.get('x-nexus-sha256')!==f.sha256) missing.push(f.path);
  }
  return {ready:missing.length===0,missing};
 }
 let preparing;
 async function prepare(group,onProgress=()=>{}) {
  if (preparing) throw new Error('Ya se están preparando modelos.');
  preparing=true;
  try {
   if (!root.caches || !root.crypto?.subtle) throw new Error('Se requiere HTTPS y almacenamiento local disponible.');
   const cache=await caches.open(cacheName),files=groupAssets(group),total=files.reduce((n,f)=>n+f.bytes,0);
   const estimate=await navigator.storage?.estimate?.();
   // Never purge user data to make room for models.
   if (estimate?.quota && estimate.quota-estimate.usage<total*1.15 && !(await cacheStatus(group)).ready) throw new Error('Espacio insuficiente. Liberá espacio del dispositivo; NEXUS no borró datos.');
   let done=0;
   for (const file of files) {
    const url=assetURL(file.path);onProgress({path:file.path,done,total});
    let response=await cache.match(url);
    if (!response) { response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error('Modelo no disponible: '+file.path+' (HTTP '+response.status+')'); }
    const bytes=await response.arrayBuffer();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
    if (bytes.byteLength!==file.bytes || hash!==file.sha256) { await cache.delete(url);throw new Error('Descarga incompleta o versión incorrecta: '+file.path+'. Reintentá la preparación.'); }
    const headers=new Headers(response.headers);headers.set('x-nexus-sha256',hash);headers.set('Content-Length',String(bytes.byteLength));
    await cache.put(url,new Response(bytes,{headers}));done+=bytes.byteLength;onProgress({path:file.path,done,total});
   }
   const persistent=await navigator.storage?.persist?.().catch(()=>false);
   return {ready:true,bytes:total,persistent:!!persistent,controlled:!!navigator.serviceWorker?.controller};
  } finally { preparing=false; }
 }
 async function requirePrepared(group) {
  if (!(await cacheStatus(group)).ready) throw new Error('Modelo no disponible. Usá «Preparar '+(group==='voice'?'voz':'visión')+' offline» con conexión antes de la expo.');
 }
 async function nativeVoice() {
  const SR=root.SpeechRecognition||root.webkitSpeechRecognition;
  if (!SR || typeof SR.available!=='function') return null;
  try {
   const recognizer=new SR();if(!('processLocally' in recognizer))return null;
   for (const lang of ['es-AR','es-ES']) if (await SR.available({langs:[lang],processLocally:true})==='available') {
    recognizer.processLocally=true;if(recognizer.processLocally===true)return {recognizer,lang};
   }
  } catch (_) {}return null;
 }
 function grammar(vocabulary=[]) {
  const terms=['nexus','nexos','nexo','nexus x','abrir','abrí','abre','cerrar','mostrar','busca','buscar','buscá','inventario','documentos','ficha','cámara','lens','analizar','analiza','analizá','esto','escáner','internet','estado','diagnóstico','calendario','agenda','agendá','agendar','agrega','agregá','recordame','tarea','evento','recordatorio','hoy','mañana','pasado mañana','lunes','martes','miércoles','jueves','viernes','sábado','domingo','preparar','revisar','reactivos','expo','ácido nítrico','ácido clorhídrico','ácido sulfúrico','hidróxido','sodio','potasio','reactivo','probeta','pipeta','bureta','matraz','erlenmeyer','vaso','microscopio','balanza','agitador','mechero','y','el','la','los','las','de','en','para','qué','tenemos'];
  const clean=s=>String(s).toLowerCase().replace(/[^a-záéíóúüñ\s]/g,' ').replace(/\s+/g,' ').trim();
  const commands=['nexus abre inventario','nexus abrir inventario','nexus abrí inventario','nexus abre documentos','nexus abre lens','nexus analiza esto','nexus abre calendario','nexus agrega una tarea','nexus recordame mañana revisar inventario','nexus agenda preparar reactivos mañana'];
  for(const name of vocabulary.slice(0,111).map(clean).filter(Boolean))commands.push('nexus busca '+name,'nexus abre inventario y busca '+name);
  return JSON.stringify([...new Set([...terms,...commands,...vocabulary.slice(0,250).flatMap(v=>[clean(v),...clean(v).split(' ')])].filter(Boolean)), '[unk]']);
 }
 let ownedVoiceModel=null,voiceModelPending=false;
 function destroyModel(model) { if(model){try{model.terminate();}catch(_){}try{model.worker?.terminate();}catch(_){}if(ownedVoiceModel===model)ownedVoiceModel=null;} }
 async function loadVoiceModel() {
  if(voiceModelPending||ownedVoiceModel)throw new Error('Motor de voz ocupado. Detené la escucha antes de preparar otro modelo.');
  voiceModelPending=true;
  try{await requirePrepared('voice');await loadScript('v1/voice/vosk.js','Vosk');}
  catch(error){voiceModelPending=false;throw error;}
  notify('voice',{state:'Inicializando voz',engine:'VOSK · WASM'});
  let model;
  try{model=new root.Vosk.Model(assetURL('v1/voice/vosk-es.tar.gz'),-2);ownedVoiceModel=model;}
  catch(error){voiceModelPending=false;throw error;}
  try { await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('El modelo de voz tardó demasiado. Reintentá.')),90000);
   const finish=(error)=>{clearTimeout(timer);error?reject(error):resolve();};
   model.on('load',message=>finish(message.result?null:new Error('No se pudo cargar el modelo de voz.')));
   model.on('error',message=>finish(new Error(message.error||message.message||JSON.stringify(message))));
   model.worker?.addEventListener('error',()=>finish(new Error('Error del worker de voz.')),{once:true});
  });return model;} catch(error){destroyModel(model);throw error;}finally{voiceModelPending=false;}
 }
 function createVoice({onTranscript=()=>{},onPartial=()=>{},onStatus=()=>{},vocabulary=[]}={}) {
  let active=false,epoch=0,native,model,recognizer,stream,context,source,node,gain,restart,starting=false;
  const status=patch=>{notify('voice',patch);onStatus(patch);};
  async function disposeAudio() {
   if(node){node.port&&(node.port.onmessage=null);node.onaudioprocess=null;try{node.disconnect();}catch(_){}node=null;}
   try{source?.disconnect();gain?.disconnect();}catch(_){}source=gain=null;
   stream?.getTracks().forEach(t=>t.stop());stream=null;
   if(context){await context.close().catch(()=>{});context=null;}
   recognizer?.remove();recognizer=null;destroyModel(model);model=null;
  }
  function stop() {
   active=false;++epoch;clearTimeout(restart);if(native){native.onend=null;native.onresult=null;try{native.abort();}catch(_){}native=null;}
   void disposeAudio();status({state:'Vigilancia detenida',microphone:'detenido'});
  }
  async function startWasm(token) {
   await disposeAudio();if(!active||token!==epoch)return;
   model=await loadVoiceModel();if(!active||token!==epoch){await disposeAudio();return;}
   const Ctx=root.AudioContext||root.webkitAudioContext;if(!Ctx)throw new Error('Audio local no compatible');
   stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
   if(!active||token!==epoch){await disposeAudio();return;}
   context=new Ctx({sampleRate:16000});await context.resume();
   recognizer=new model.KaldiRecognizer(context.sampleRate,grammar(vocabulary));
   recognizer.on('result',m=>{if(active&&token===epoch&&m.result?.text)onTranscript(m.result.text);});
   recognizer.on('partialresult',m=>{if(active&&token===epoch&&m.result?.partial)onPartial(m.result.partial);});
   recognizer.on('error',m=>{if(active){stop();status({state:'Error recuperable',error:m.error||'Error del reconocedor'});}});
   source=context.createMediaStreamSource(stream);gain=context.createGain();gain.gain.value=0;
   const send=pcm=>{if(active&&token===epoch&&recognizer)recognizer.acceptWaveformFloat(pcm,context.sampleRate);};
   if(context.audioWorklet && root.AudioWorkletNode) {
    try{await context.audioWorklet.addModule(assetURL('audio-worklet.js'));node=new AudioWorkletNode(context,'nexus-pcm');node.port.onmessage=e=>send(e.data);}catch(_){node=null;}
   }
   if(!active||token!==epoch){await disposeAudio();return;}
   if(!node){node=context.createScriptProcessor(4096,1,1);node.onaudioprocess=e=>send(e.inputBuffer.getChannelData(0));}
   source.connect(node);node.connect(gain);gain.connect(context.destination);
   for(const track of stream.getTracks())track.addEventListener?.('ended',()=>{if(active){stop();status({state:'Error recuperable',error:'Micrófono interrumpido. Tocá Activar.'});}});
   status({engine:'VOSK · WASM',state:'Fallback local activo',language:'es',microphone:'permitido',local:true});
  }
  async function start({forceWasm=false}={}) {
   if(active||starting)return;starting=true;active=true;const token=++epoch;
   try {
    const local=forceWasm?null:await nativeVoice();if(!active||token!==epoch)return;
    if(local) {
     native=local.recognizer;native.lang=local.lang;native.continuous=true;native.interimResults=true;let failures=0;
     native.onresult=e=>{if(!active||token!==epoch)return;for(let i=e.resultIndex;i<e.results.length;i++){
      const text=e.results[i][0].transcript;e.results[i].isFinal?onTranscript(text):onPartial(text);
     }};
     native.onstart=()=>{failures=0;status({engine:'Nativo local',state:'Voz offline activa',language:local.lang,microphone:'permitido'});};
     const fallback=()=>{if(!active||token!==epoch)return;native.onend=null;native.onerror=null;try{native.abort();}catch(_){}native=null;
      startWasm(token).catch(error=>{stop();status({state:'Error recuperable',error:error.message});});};
     native.onerror=e=>{if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error)){stop();status({state:'Micrófono bloqueado',error:e.error});}else if(e.error!=='no-speech'&&e.error!=='aborted')fallback();};
     native.onend=()=>{if(!active)return;if(++failures>3)return fallback();restart=setTimeout(()=>{if(active&&native)try{native.start();}catch(_){fallback();}},400);};
     try{native.start();}catch(_){native.onend=null;native.onerror=null;native=null;await startWasm(token);}
    } else await startWasm(token);
   } catch(error) {stop();status({state:error.name==='NotAllowedError'?'Micrófono bloqueado':'Error recuperable',error:error.message});throw error;}
   finally{starting=false;}
  }
  return {start,stop,get active(){return active;}};
 }
 let visionWorker,serial=0,idleTimer,ocrWorker,ocrSerial=0,ocrIdleTimer;const jobs=new Map(),ocrJobs=new Map();
 function releaseOcr() {
  clearTimeout(ocrIdleTimer);ocrWorker?.terminate();ocrWorker=null;
  for(const job of ocrJobs.values()){clearTimeout(job.timer);job.reject(new Error('Motor OCR liberado'));}ocrJobs.clear();
  notify('lens',{ocr:'PP-OCRv6 Tiny · liberado'});
 }
 function releaseVision() {
  clearTimeout(idleTimer);visionWorker?.terminate();visionWorker=null;
  for(const job of jobs.values()){clearTimeout(job.timer);job.reject(new Error('Motor visual liberado'));}jobs.clear();
  releaseOcr();
  notify('lens',{embedding:'liberado'});
 }
 async function visionRequest(type,pixels,options={}) {
  await requirePrepared('vision');clearTimeout(idleTimer);
  if(jobs.size)throw new Error('Ya hay un análisis visual en curso.');
  if(!visionWorker) {
   visionWorker=new Worker(assetURL('vision-worker.js'));
   visionWorker.onmessage=({data})=>{
    const job=jobs.get(data.id);if(!job)return;jobs.delete(data.id);clearTimeout(job.timer);
    if(data.error)job.reject(new Error(data.error));else {notify('lens',{runtime:data.result.backend,embedding:'READY',cache:true,lastInference:data.result.at,durationMs:data.result.durationMs});job.resolve(data.result);}
    idleTimer=setTimeout(releaseVision,60000);
   };
   visionWorker.onerror=()=>releaseVision();
  }
  notify('lens',{embedding:'Inicializando / analizando'});
  const id=++serial;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{releaseVision();},90000);jobs.set(id,{resolve,reject,timer});
   const views=Array.isArray(pixels)?pixels.filter(Boolean):pixels?[pixels]:[];
   visionWorker.postMessage({id,type,pixels:views,forceWasm:!!options.forceWasm},views);
  });
 }
 async function ocrRequest(type,source,options={}) {
  await requirePrepared('vision');clearTimeout(ocrIdleTimer);
  if(ocrJobs.size)throw new Error('Ya hay un análisis OCR local en curso.');
  if(!ocrWorker){
   ocrWorker=new Worker(assetURL('ocr-worker.js'));
   ocrWorker.onmessage=({data})=>{
    const job=ocrJobs.get(data.id);if(!job)return;ocrJobs.delete(data.id);clearTimeout(job.timer);
    if(data.error){
     notify('lens',{ocr:'PP-OCRv6 Tiny · error',ocrError:data.error});
     job.reject(new Error(data.error));
    }else{
     const result=data.result;
     notify('lens',{runtime:result.backend,ocr:`PP-OCRv6 Tiny · ${result.backend}`,ocrDetector:result.detector,ocrRecognizer:result.recognizer,ocrBackend:result.backend,ocrCached:true,ocrDurationMs:result.durationMs||0,ocrLines:result.lines?.length||0,ocrError:''});
     job.resolve(result);
    }
    ocrIdleTimer=setTimeout(releaseOcr,60000);
   };
   ocrWorker.onerror=event=>{
    const message=event.message||'Fallo no especificado del worker OCR local.';
    notify('lens',{ocr:'PP-OCRv6 Tiny · error',ocrError:message});
    releaseOcr();
   };
  }
  notify('lens',{ocr:`PP-OCRv6 Tiny · ${type==='prepare'?'inicializando':'analizando'}`});
  const id=++ocrSerial;
  let image=null,transfer=[];
  if(type==='recognize'){
   const width=source?.naturalWidth||source?.videoWidth||source?.width,height=source?.naturalHeight||source?.videoHeight||source?.height;
   if(!width||!height)throw new Error('Imagen OCR vacía.');
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(source,0,0,width,height);
   const rgba=context.getImageData(0,0,width,height).data;
   image={rgba:rgba.buffer,width,height};transfer=[rgba.buffer];
  }
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{releaseOcr();},90000);ocrJobs.set(id,{resolve,reject,timer});
   ocrWorker.postMessage({id,type,image,forceWasm:!!options.forceWasm},transfer);
  });
 }
 function pixelsFor(source,view='center') {
  const w=source.width||source.naturalWidth,h=source.height||source.naturalHeight;if(!w||!h)throw new Error('Imagen vacía');
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  if(view==='letterbox'){
   const scale=Math.min(256/w,256/h),width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(h*scale));
   ctx.fillStyle='#808080';ctx.fillRect(0,0,256,256);ctx.drawImage(source,0,0,w,h,(256-width)/2,(256-height)/2,width,height);
  }else{
   const side=Math.min(w,h);ctx.drawImage(source,(w-side)/2,(h-side)/2,side,side,0,0,256,256);
  }
  const rgba=ctx.getImageData(0,0,256,256).data,data=new Float32Array(3*256*256);
  for(let i=0;i<256*256;i++)for(let c=0;c<3;c++)data[c*256*256+i]=rgba[4*i+c]/255;
  canvas.width=canvas.height=1;return data.buffer;
 }
 // Separate database: never migrate production inventory or document stores.
 async function referenceDB() {
  return new Promise((resolve,reject)=>{const r=indexedDB.open(referenceDBName,1);r.onupgradeneeded=()=>r.result.createObjectStore('references',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 }
 async function references() {
  const db=await referenceDB();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('references'),r=tx.objectStore('references').getAll();tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);});}finally{db.close();}
 }
 async function saveReference({recordId,label,embedding}) {
  if(!/^NEXUS-X-\d{4}$/.test(recordId)||!Array.isArray(embedding)||embedding.length!==512||!embedding.every(Number.isFinite))throw new Error('Referencia inválida');
  const db=await referenceDB();try{await new Promise((resolve,reject)=>{const tx=db.transaction('references','readwrite');tx.objectStore('references').put({id:recordId+':'+Date.now(),recordId,label:String(label).slice(0,200),embedding,model:'MobileCLIP-S0',createdAt:new Date().toISOString()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
 }
 async function analyze(source,options={}) {
  const result=await visionRequest('analyze',[pixelsFor(source,'center'),pixelsFor(source,'letterbox')],options);
  try{result.references=(await references()).filter(r=>r.model===result.model).map(r=>({recordId:r.recordId,label:r.label,similarity:r.embedding.reduce((s,v,i)=>s+v*result.embedding[i],0)})).filter(r=>r.similarity>=.85).sort((a,b)=>b.similarity-a.similarity).slice(0,3);}catch(error){result.references=[];result.referenceError=error.message;}
  return result;
 }
 async function prepareVision(options={}) {
  const vision=await visionRequest('prepare',null,options);
  try{
   const ocr=await ocrRequest('prepare',null,options);
   return {...vision,ocr};
  }catch(error){
   notify('lens',{ocr:'PP-OCRv6 Tiny · no disponible',ocrError:error.message});
   return {...vision,ocr:{ready:false,error:error.message}};
  }
 }
 root.NexusOffline={prepare,cacheStatus,diagnostics,nativeVoice,createVoice,grammar,analyze,saveReference,releaseVision,
  recognizeText:source=>ocrRequest('recognize',source),
  releaseOcr,
  async prepareVoice(){const model=await loadVoiceModel();destroyModel(model);notify('voice',{state:'Voz local lista',engine:'VOSK · WASM'});},
  prepareVision};
})(globalThis);
