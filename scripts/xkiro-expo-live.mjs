// Optional live validation. Uses only synthetic input and the existing gateway;
// never reads, writes or prints credentials. Not run by the offline test suite.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {harness,root} from '../harness.mjs';
const [imagePath,outputPath]=process.argv.slice(2);
if(!imagePath||!outputPath)throw new Error('Usage: node scripts/xkiro-expo-live.mjs synthetic.png results.json');
const source=fs.readFileSync(new URL('app.js',root),'utf8').replace("const xkiroGoodModels=readJsonStorage(XKIRO_GOOD_MODEL_KEY,{});",`const xkiroGoodModels=${JSON.stringify({text:{id:'inclusionai/ling-3.0-flash-sante:free',at:Date.now()}})};`);
const requests=[];
const h=harness({source,fetcher:async(url,options={})=>{
 const response=await fetch(url,{...options,headers:{...options.headers,Origin:'https://miqueas80.github.io','User-Agent':'NEXUS-readonly-diagnostic'}});
 requests.push({status:response.status,model:options.body?JSON.parse(options.body).model:null,path:new URL(url).pathname,rayId:response.headers.get('CF-Ray'),serverDate:response.headers.get('Date')});return response;
}});
const result={validation:'actual app.js in JSDOM with live existing gateway',requests};
try{
 h.api.state.web=true;
 const text=await h.api.xkiroGenerate({question:'Saludá brevemente en español.',maxTokens:32});result.text={model:text.model,answer:text.answer,attemptedModels:text.attemptedModels};
 assert.equal(text.model,'mistralai/ministral-14b');assert.ok(text.answer.length);assert.deepEqual(Array.from(text.attemptedModels),['inclusionai/ling-3.0-flash-sante:free','mistralai/ministral-14b']);
 const vision=await h.api.xkiroVisionAnalyze({imageDataUrl:'data:image/png;base64,'+fs.readFileSync(imagePath).toString('base64'),context:'Imagen sintética de prueba, sin datos de laboratorio.'});
 result.vision=vision;assert.equal(vision.model,'mistralai/ministral-14b');
 result.diagnostics=h.api.health.xkiro;result.passed=true;
}catch(error){result.passed=false;result.failure=error.xkiroDiagnostic||{message:'La validación no se completó; consultar estados HTTP registrados.'};result.diagnostics=h.api.health.xkiro;process.exitCode=1;}
finally{h.close();fs.writeFileSync(outputPath,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
