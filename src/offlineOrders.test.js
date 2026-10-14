import { setImmediate } from 'node:timers';
import test from 'node:test';
import assert from 'node:assert/strict';
import {queueOfflineOrder} from './offlineOrders.js';
function mockDatabase(t) {
 const original=globalThis.indexedDB;
 const transaction={objectStore:()=>({put:()=>{const request={result:123};queueMicrotask(()=>request.onsuccess());return request;}})};
 globalThis.indexedDB={open(){const request={result:{transaction:()=>transaction,close(){}}};queueMicrotask(()=>request.onsuccess());return request;}};
 t.after(()=>{if(original===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=original;});
 return transaction;
}
test('queue success waits for the IndexedDB transaction commit',async t=>{
 const transaction=mockDatabase(t);let confirmed=false;
 const pending=queueOfflineOrder({id:123,flavour:'Lady Killer',time:new Date()}).then(()=>{confirmed=true;});
 await new Promise(setImmediate);assert.equal(confirmed,false);
 transaction.oncomplete();await pending;assert.equal(confirmed,true);
});
test('an aborted local transaction rejects even after request success',async t=>{
 const transaction=mockDatabase(t);
 const pending=queueOfflineOrder({id:123,flavour:'Lady Killer',time:new Date()});
 await new Promise(setImmediate);const assertion=assert.rejects(pending,/interrupted/);
 transaction.onabort();await assertion;
});
