// Regresiones del failover original adaptadas al contrato xKiro Gateway vigente.
import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,master} from './harness.mjs';
const chain=['preferred','secondary','last'];
const catalog=ids=>Response.json({data:ids.map(id=>({id,access_tier:'free',capabilities:{}}))});
for(const statuses of [[200],[503,503,200],[401],[403],[400],[429],[500,502,200]])test('Gateway failover runtime '+statuses,async()=>{
 const attempts=[];const h=harness({stored:master.records,fetcher:(url,opts)=>{
  if(!opts?.body)return catalog(chain);
  attempts.push(JSON.parse(opts.body).model);const status=statuses[attempts.length-1];assert.ok(status,'no repetir modelos');
  return status===200?Response.json({choices:[{message:{content:'OK'}}]}):new Response('',{status,headers:status===429?{'Retry-After':'60'}:{}});
 }});
 try{await h.api.loadMaster();h.api.state.web=true;
  if(statuses.at(-1)===200){const out=await h.api.xkiroGenerate({question:'test'});assert.equal(out.model,chain[statuses.length-1])}
  else await assert.rejects(h.api.xkiroGenerate({question:'test'}));
  assert.deepEqual(attempts,chain.slice(0,statuses.length));
  if(statuses[0]===401||statuses[0]===403)assert.deepEqual(Array.from(h.api.orderXKiroCandidates(chain.map(id=>({id}))),x=>x.id),chain);
  const local=await h.api.nexusAgentTurn('Nexus busca ácido nítrico');assert.equal(local.actions[0].result.ok,true);assert.equal(h.api.state.inventory.length,111);
 }finally{h.close()}
});
test('503 cooldown conserva prioridad del último modelo funcional al expirar',async()=>{
 const attempts=[];let now=1000000;const h=harness({fetcher:(url,opts)=>{
  if(!opts?.body)return catalog(chain);
  const model=JSON.parse(opts.body).model;attempts.push(model);
  return model==='last'?Response.json({choices:[{message:{content:'OK'}}]}):new Response('',{status:503});
 }});
 try{h.api.state.web=true;h.window.Date.now=()=>now;
  await h.api.xkiroGenerate({question:'test'});await h.api.xkiroGenerate({question:'test'});assert.deepEqual(attempts,[...chain,'last']);
  now+=13*60*1000;assert.deepEqual(Array.from(h.api.orderXKiroCandidates(chain.map(id=>({id}))),x=>x.id),['last','preferred','secondary']);
 }finally{h.close()}
});
test('429 bloquea nuevos intentos hasta Retry-After',async()=>{
 let now=1000000,attempts=0;const h=harness({fetcher:(url,opts)=>{
  if(!opts?.body)return catalog(chain);attempts++;return new Response('',{status:429,headers:{'Retry-After':'120'}});
 }});
 try{h.api.state.web=true;h.window.Date.now=()=>now;await assert.rejects(h.api.xkiroGenerate({question:'test'}));await assert.rejects(h.api.xkiroGenerate({question:'test'}));assert.equal(attempts,1);now+=120001;await assert.rejects(h.api.xkiroGenerate({question:'test'}));assert.equal(attempts,2)}finally{h.close()}
});
test('sólo modelos confirmados por /models',async()=>{
 const attempts=[];const h=harness({fetcher:(url,opts)=>{if(!opts?.body)return catalog(['confirmed']);attempts.push(JSON.parse(opts.body).model);return Response.json({choices:[{message:{content:'OK'}}]})}});
 try{h.api.state.web=true;await h.api.xkiroGenerate({question:'test'});assert.deepEqual(attempts,['confirmed'])}finally{h.close()}
});
