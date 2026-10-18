import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
function worker(fetch,caches){const handlers={};vm.runInNewContext(source,{self:{location:{origin:'https://pos.test'},addEventListener:(name,fn)=>{handlers[name]=fn;},skipWaiting(){},clients:{claim(){}}},fetch,caches,URL});return handlers;}
test('offline reload returns the previously cached selling page',async()=>{
 const page={body:'cached app'};const handlers=worker(async()=>{throw Error('offline');},{match:async path=>{assert.equal(path,'/');return page;}});let response;
 handlers.fetch({request:{method:'GET',url:'https://pos.test/',mode:'navigate'},respondWith:value=>{response=value;}});
 assert.equal(await response,page);
});
test('offline flavour photos are served without a network request',async()=>{
 const photo={body:'photo'};const handlers=worker(()=>{throw Error('Unexpected network');},{match:async()=>photo});let response;
 handlers.fetch({request:{method:'GET',url:'https://pos.test/brand/lady-killer.webp'},respondWith:value=>{response=value;}});
 assert.equal(await response,photo);
});
test('private database requests and sale writes are never cached by the worker',()=>{
 const handlers=worker(()=>{throw Error('Unexpected fetch');},{});
 for(const request of [{method:'POST',url:'https://pos.test/sale'},{method:'GET',url:'https://database.test/rest/v1/pos_orders'}])handlers.fetch({request,respondWith:()=>{throw Error('Intercepted private/write request');}});
});
