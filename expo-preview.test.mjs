import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {harness,master} from './harness.mjs';
test('Expo: almacenamiento de producción no se lee, escribe ni borra',async()=>{
 const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8').replace("'use strict';","'use strict';globalThis.localStorage.setItem('nexus_xkiro_api_key_v1','test-placeholder');");const h=harness({url:'https://miqueas80.github.io/NEXUS-X-expo-test/',stored:master.records.slice(0,1),source});try{await h.api.loadMaster();assert.equal(h.api.state.inventory.length,111);assert.equal(JSON.parse(h.window.localStorage.getItem('nexus_x_inventory_v1')).length,1);assert.equal(h.window.localStorage.getItem('nexus_xkiro_api_key_v1'),'test-placeholder');assert.equal(JSON.parse(h.window.localStorage.getItem('nexus-expo-test:nexus_x_inventory_v1')).length,111);const prior=h.api.state.inventory;h.api.bind();h.window.dispatchEvent(new h.window.StorageEvent('storage',{key:'nexus_x_inventory_v1',newValue:'[]'}));assert.equal(h.api.state.inventory,prior);}finally{h.close()}
});
test('Lens: evidencia estructurada se muestra sin object Object',()=>{const h=harness();try{const result=h.api.parseLensVisionPayload({observableEvidence:[{description:'superficie roja'},null,'etiqueta'],objects:[{name:'frasco'}]});assert.ok(result.observableEvidence[0].includes('superficie roja'));assert.ok(!JSON.stringify(result).includes('[object Object]'));assert.equal(result.observableEvidence.length,2);}finally{h.close()}});
