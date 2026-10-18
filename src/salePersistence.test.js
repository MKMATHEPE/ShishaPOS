import test from 'node:test';
import assert from 'node:assert/strict';
import {salePayload,persistSale,syncPendingSales,syncRetryDelay} from './salePersistence.js';
const order={id:123,flavour:{id:'lk',name:'Lady Killer'},type:'full',payment:'cash',price:170,time:'2026-10-13T22:30:00Z',soldBy:'Test',ownerId:'staff-a'};
test('queued string and online object flavours create identical retry payloads with Johannesburg dates',()=>{
 assert.deepEqual(salePayload(order),salePayload({...order,flavour:'Lady Killer'}));
 assert.equal(salePayload(order).session_date,'2026-10-14');
});
test('offline sale is durably queued without sending or deleting',async()=>{
 const calls=[];const result=await persistSale(order,{online:false,queue:async()=>calls.push('queue'),send:()=>{throw Error('Unexpected send');},remove:()=>{throw Error('Unexpected delete');}});
 assert.deepEqual(result,{saved:false,pendingSync:true});assert.deepEqual(calls,['queue']);
});
test('failed local persistence does not send a sale or claim success',async()=>{
 await assert.rejects(persistSale(order,{online:true,queue:async()=>{throw Error('Storage full');},send:()=>{throw Error('Must not send');}}),/Storage full/);
});
test('online sale queues before sending and removes only after confirmation',async()=>{
 const calls=[];const result=await persistSale(order,{online:true,queue:async()=>calls.push('queue'),send:async()=>{calls.push('send');return true;},remove:async()=>calls.push('remove')});
 assert.deepEqual(calls,['queue','send','remove']);assert.deepEqual(result,{saved:true,pendingSync:false});
});
test('a lost server response leaves the same sale ID available for a safe retry',async()=>{
 const queued=new Map(),committed=new Set();let deductions=0;
 const send=async sale=>{if(!committed.has(sale.id)){committed.add(sale.id);deductions++;throw Error('Response lost');}return true;};
 const result=await persistSale(order,{online:true,queue:async o=>queued.set(o.id,o),send,remove:async id=>queued.delete(id)});
 assert.equal(result.pendingSync,true);assert.equal(queued.size,1);
 assert.equal(await syncPendingSales({ownerId:'staff-a',list:async()=>[...queued.values()],send,remove:async id=>queued.delete(id),onSynced:()=>{}}),1);
 assert.equal(deductions,1);assert.equal(queued.size,0);
});
test('failed queue cleanup keeps a confirmed sale pending for retry',async()=>{
 const result=await persistSale(order,{online:true,queue:async()=>{},send:async()=>true,remove:async()=>{throw Error('Storage failure');}});
 assert.deepEqual(result,{saved:true,pendingSync:true});
});
test('sync skips an unconfirmed sale and uploads later sales',async()=>{
 const deleted=[],synced=[];
 const count=await syncPendingSales({ownerId:'staff-a',list:async()=>[{id:1,ownerId:'staff-a'},{id:2,ownerId:'staff-a'},{id:3,ownerId:'staff-a'}],send:async o=>o.id!==2,remove:async id=>deleted.push(id),onSynced:o=>synced.push(o.id)});
 assert.equal(count,2);assert.deepEqual(deleted,[1,3]);assert.deepEqual(synced,[1,3]);
});

test('sync only sends the signed-in owner’s orders and preserves other and legacy sales', async () => {
 const sent=[],deleted=[];
 const pending=[{id:1,ownerId:'staff-b'},{id:2},{id:3,ownerId:'staff-a'}];
 const result=await syncPendingSales({ownerId:'staff-a',list:async()=>pending,send:async o=>{sent.push(o.id);return true;},remove:async id=>deleted.push(id),onSynced:()=>{}});
 assert.equal(result,1);assert.deepEqual(sent,[3]);assert.deepEqual(deleted,[3]);
});
test('signed-out syncing never sends or deletes queued sales', async () => {
 const result=await syncPendingSales({list:async()=>[order],send:()=>{throw Error('Unexpected send');},remove:()=>{throw Error('Unexpected delete');},onSynced:()=>{}});
 assert.equal(result,0);
});

test('a thrown request failure keeps its sale and does not block later orders',async()=>{
 const deleted=[];
 const count=await syncPendingSales({ownerId:'staff-a',list:async()=>[{...order,id:1},{...order,id:2}],send:async o=>{if(o.id===1)throw Error('Network lost');return true;},remove:async id=>deleted.push(id),onSynced:()=>{}});
 assert.equal(count,1);assert.deepEqual(deleted,[2]);
});
test('failed local cleanup is safely retried without duplicating the remote sale',async()=>{
 const committed=new Set();let fail=true;let removed=0;
 const args={ownerId:'staff-a',list:async()=>[order],send:async o=>{committed.add(o.id);return true;},remove:async()=>{if(fail)throw Error('Storage busy');removed++;},onSynced:()=>{}};
 assert.equal(await syncPendingSales(args),0);
 fail=false;assert.equal(await syncPendingSales(args),1);
 assert.equal(committed.size,1);assert.equal(removed,1);
});
test('automatic retry delay increases and stays bounded at one minute',()=>{
 assert.deepEqual([0,1,2,3,4,99].map(syncRetryDelay),[5000,10000,20000,40000,60000,60000]);
});

test('expired session keeps orders until a later authenticated sync succeeds',async()=>{
 const pending=new Map([[order.id,order]]);let valid=false;
 const args={ownerId:'staff-a',list:async()=>[...pending.values()],send:async()=>{if(!valid)throw Error('Session expired');return true;},remove:async id=>pending.delete(id),onSynced:()=>{}};
 assert.equal(await syncPendingSales(args),0);assert.equal(pending.size,1);
 valid=true;assert.equal(await syncPendingSales(args),1);assert.equal(pending.size,0);
});

test('reopened app can sync a serialized queue after a lost response',async()=>{
 const disk=[];const committed=new Set();let first=true;
 const send=async sale=>{committed.add(sale.id);if(first){first=false;throw Error('Lost response');}return true;};
 await persistSale(order,{online:true,queue:async sale=>disk.push(JSON.stringify(sale)),send,remove:async()=>{disk.length=0;}});
 const reopened=JSON.parse(disk[0]);
 assert.equal(await syncPendingSales({ownerId:'staff-a',list:async()=>[reopened],send,remove:async()=>{disk.length=0;},onSynced:()=>{}}),1);
 assert.equal(committed.size,1);assert.equal(disk.length,0);
});
