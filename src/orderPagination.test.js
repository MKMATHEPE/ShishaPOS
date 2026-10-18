import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderPage} from './orderPagination.js';
test('orders show five newest first without mutating the source',()=>{
 const orders=Array.from({length:12},(_,id)=>({id,time:new Date(2026,9,18,id)}));
 const first=orderPage(orders);
 assert.deepEqual(first.items.map(o=>o.id),[11,10,9,8,7]);
 assert.equal(first.totalPages,3);
 assert.deepEqual(orderPage(orders,1).items.map(o=>o.id),[6,5,4,3,2]);
 assert.equal(orders[0].id,0);
});
test('order pages deduplicate return pipes, break ties and clamp after removal',()=>{
 const orders=[{id:1,time:'2026-10-18T12:00:00Z'},{id:2,time:'2026-10-18T12:00:00Z'}];
 assert.deepEqual(orderPage([...orders,...orders],8).items.map(o=>o.id),[2,1]);
 assert.equal(orderPage([],3).page,0);
});
