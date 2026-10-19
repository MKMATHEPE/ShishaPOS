import test from 'node:test';
import assert from 'node:assert/strict';
import {installRuntimeMonitoring} from './monitoringRuntime.js';
function harness(fetch) {
 const listeners=new Map(),events=[];let time=0;
 const window={fetch,addEventListener(name,listener){listeners.set(name,listener);}};
 installRuntimeMonitoring(window,(...args)=>events.push(args),{now:()=>time,getEntriesByType:()=>[{domContentLoadedEventEnd:350}]});
 return {window,events,listeners,advance(ms){time+=ms;}};
}
test('broken monitoring never changes successful requests or replaces the original network error',async()=>{
 const original=Error('network failure');let fail=false;
 const response={ok:false,status:403};
 const window={fetch:async()=>{if(fail)throw original;return response;},addEventListener(){}};
 installRuntimeMonitoring(window,()=>{throw Error('diagnostics failed');},{now:()=>0});
 assert.equal(await window.fetch('/save'),response);
 fail=true;
 await assert.rejects(window.fetch('/save'),error=>error===original);
});
test('failed writes are reported while the original response remains available',async()=>{
 const response={ok:false,status:403};const h=harness(async()=>response);
 assert.equal(await h.window.fetch('/rest/v1/pos_stock',{method:'PATCH',body:'private description'}),response);
 assert.deepEqual(h.events,[['save_failed','request_failed',0]]);
});
test('failed reads are reported as errors, not failed saves',async()=>{
 const h=harness(async()=>({ok:false}));await h.window.fetch('/rest/v1/pos_orders');assert.equal(h.events[0][0],'error');
});
test('slow requests record duration without storing URL, token or body',async()=>{
 const h=harness(async()=>{h.advance(2500);return {ok:true};});
 await h.window.fetch('/secret?token=private',{body:'private notes'});
 assert.deepEqual(h.events,[['slow_request','slow_request',2500]]);
});
test('network errors propagate so the caller can retain its unsaved form',async()=>{
 const error=Error('private financial detail');const h=harness(async()=>{throw error;});
 await assert.rejects(h.window.fetch('/save'),value=>value===error);
 assert.deepEqual(h.events,[['error','network_error',0]]);
});
test('cancelled requests and failing diagnostics do not create recursive reports',async()=>{
 const error=Error('abort');error.name='AbortError';const h=harness(async()=>{throw error;});
 await assert.rejects(h.window.fetch('/save'));assert.equal(h.events.length,0);
 const d=harness(async()=>({ok:false}));await d.window.fetch('/rpc/record_pos_diagnostic');assert.equal(d.events.length,0);
});
test('runtime errors, rejected promises and page timings capture only categories',()=>{
 const h=harness(async()=>({ok:true}));h.listeners.get('error')({message:'password'});h.listeners.get('unhandledrejection')({reason:'private'});h.listeners.get('load')();
 assert.deepEqual(h.events,[['error','runtime_error'],['error','unhandled_rejection'],['page_load','page_load',350]]);
});
