import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');
function worker({failInstall=false,base="https://miqueas80.github.io/Laboratorio2.0/"}={}){
 const stores=new Map(),handlers={};let network=0,claimed=0;
 const caches={keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key),open:async key=>{
  if(!stores.has(key))stores.set(key,new Map());const store=stores.get(key);
  return {addAll:async requests=>{for(const req of requests){const url=new URL(req.url);assert.equal(url.origin,new URL(base).origin);assert.ok(url.pathname.startsWith(new URL(base).pathname));const file=decodeURIComponent(url.pathname.slice(new URL(base).pathname.length))||'index.html';assert.ok(fs.existsSync(new URL('./'+file,import.meta.url)),file);if(failInstall&&file==='pdf.mjs')throw new Error('recurso caído');store.set(req.url,new Response(file));}},match:async url=>store.get(typeof url==='string'?url:url.url)?.clone()};
 }};
 const env={self:{registration:{scope:base},clients:{claim:async()=>{claimed++}},addEventListener:(event,fn)=>handlers[event]=fn},caches,URL,Request,Response,fetch:async()=>{network++;throw new Error('offline')}};env.globalThis=env.self;env.importScripts=path=>vm.runInNewContext(fs.readFileSync(new URL(path,import.meta.url),'utf8'),env);vm.runInNewContext(source,env);
 const lifecycle=type=>{let done;handlers[type]({waitUntil:p=>done=p});return done};
 const request=async(path,mode)=>{let response;handlers.fetch({request:{url:new URL(path,base).href,method:'GET',mode},respondWith:p=>response=p});return response?await response:null};
 return {stores,lifecycle,request,get network(){return network},get claimed(){return claimed}};
}
test('PWA: instalación local completa, navegación /Laboratorio2.0/ y lectores disponibles sin red',async()=>{
 const w=worker();await w.lifecycle('install');await w.lifecycle('activate');
 for(const path of ['./','./?source=pwa','./documents','./app.js?v=123','./catalogo_maestro.json','./pdf.mjs','./pdf.worker.mjs','./document-worker.js','./offline/ocr-worker.js','./jszip.min.js','./xlsx.full.min.js']){
  const res=await w.request(path,/documents|source|^\.\/$/.test(path)?'navigate':undefined);assert.equal(res?.status,200,path);
 }assert.equal(w.network,0);assert.equal(w.claimed,0);assert.equal(await w.request('/otra-app/app.js'),null);assert.equal(await w.request('https://cdn.example.org/x.js'),null);
});
test('PWA: activación sólo retira cachés del ámbito propio',async()=>{
 const w=worker();w.stores.set('otra-app-cache',new Map());w.stores.set('nexus-x-shell:%2Fotra%2F:old',new Map());w.stores.set('nexus-x-shell:%2FLaboratorio2.0%2F:old',new Map());await w.lifecycle('install');await w.lifecycle('activate');
 assert.ok(w.stores.has('otra-app-cache'));assert.ok(w.stores.has('nexus-x-shell:%2Fotra%2F:old'));assert.equal(w.stores.has('nexus-x-shell:%2FLaboratorio2.0%2F:old'),false);
});
test('PWA: actualización incompleta conserva versión anterior y no fuerza activación',async()=>{
 const w=worker({failInstall:true});w.stores.set('nexus-x-shell:%2FLaboratorio2.0%2F:old',new Map());await assert.rejects(w.lifecycle('install'),/recurso caído/);
 assert.deepEqual([...w.stores.keys()],['nexus-x-shell:%2FLaboratorio2.0%2F:old']);assert.equal(w.claimed,0);
});

test('PWA: modelos preparados sobreviven activación y se sirven sin red; faltantes no fingen READY',async()=>{
 const w=worker(),key='nexus-x-models:%2FLaboratorio2.0%2F:2026.10.07-r30-lens-final',url='https://miqueas80.github.io/Laboratorio2.0/offline/v1/voice/vosk-es.tar.gz';
 w.stores.set(key,new Map([[url,new Response('model bytes')]]));await w.lifecycle('install');await w.lifecycle('activate');
 assert.ok(w.stores.has(key));const res=await w.request('./offline/v1/voice/vosk-es.tar.gz');assert.equal(await res.text(),'model bytes');assert.equal(w.network,0);
 assert.equal((await w.request('./offline/v1/vision/mobileclip-s0.onnx')).status,503);
 assert.equal((await w.request('./offline/v1/vision/ocr/PP-OCRv6_tiny_det.onnx')).status,503);
});

test('Expo: shell aislado, rutas relativas y caché de producción conservada',async()=>{
 const w=worker({base:'https://miqueas80.github.io/NEXUS-X-expo-test/'});w.stores.set('nexus-x-shell:%2FLaboratorio2.0%2F:production',new Map());await w.lifecycle('install');await w.lifecycle('activate');assert.ok(w.stores.has('nexus-x-shell:%2FLaboratorio2.0%2F:production'));for(const path of ['./','./app.js','./manifest.webmanifest'])assert.equal((await w.request(path,path==='./'?'navigate':undefined)).status,200);assert.equal(await w.request('/Laboratorio2.0/app.js'),null);
});
