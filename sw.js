'use strict';
// Incrementar VERSION junto con APP_VERSION cuando cambie cualquier recurso CORE.
const VERSION='2026.10.07-r31.2-xkiro-expo-test';
importScripts('./offline/assets.js');
const SCOPE=new URL(self.registration.scope);
const PREFIX='nexus-x-shell:'+encodeURIComponent(SCOPE.pathname)+':';
const CACHE=PREFIX+VERSION;
const CORE=['./','./index.html','./app.js','./manifest.webmanifest','./icon.svg',
 './icon-192.png','./icon-512.png','./inventory.json','./catalogo_maestro.json','./documents-manifest.json','./document-worker.js',
 './jszip.min.js','./xlsx.full.min.js','./jsQR.js',
 './pdf.mjs','./pdf.worker.mjs','./offline/assets.js','./offline/core.js',
 './offline/vision-worker.js','./offline/ocr-worker.js','./offline/audio-worklet.js'];
const URLS=new Set(CORE.map(path=>new URL(path,SCOPE).href));
// Large engines are explicitly prepared, independently of the atomic application shell.
const MODEL_CACHE='nexus-x-models:'+encodeURIComponent(SCOPE.pathname)+':'+self.NEXUS_OFFLINE_ASSETS.version;
const MODEL_URLS=new Set(self.NEXUS_OFFLINE_ASSETS.files.map(file=>new URL('./offline/'+file.path,SCOPE).href));

self.addEventListener('install',event=>{
 // Instalación completa o ninguna: no sustituir un núcleo operativo a medias.
 event.waitUntil((async()=>{
  try{const cache=await caches.open(CACHE);await cache.addAll([...URLS].map(url=>new Request(url,{cache:'reload'})))}
  catch(error){await caches.delete(CACHE);throw error}
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)));
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==SCOPE.origin||!url.pathname.startsWith(SCOPE.pathname))return;
 const clean=new URL(url);clean.search='';clean.hash='';
 if(MODEL_URLS.has(clean.href)&&!URLS.has(clean.href)){
  event.respondWith((async()=>{
   const cached=await (await caches.open(MODEL_CACHE)).match(clean.href);
   if(cached)return cached;
   try{return await fetch(request)}catch{return new Response('Modelo local no preparado. Reconectá y prepará los motores offline.',{status:503})}
  })());return;
 }
 // HTML y lectores pertenecen a la misma versión. No actualizar archivos sueltos.
 const target=request.mode==='navigate'?new URL('./index.html',SCOPE).href:clean.href;
 if(!URLS.has(target))return;
 event.respondWith((async()=>{
  const cached=await (await caches.open(CACHE)).match(target);
  if(cached)return cached;
  try{return await fetch(request)}catch{return new Response('Recurso local no disponible. Reconectá para reparar la instalación.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})}
 })());
});
