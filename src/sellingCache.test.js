import test from 'node:test';
import assert from 'node:assert/strict';
import {readSellingCache,cacheSellingData} from './sellingCache.js';
function storage(){let raw=null;return {getItem:()=>raw,setItem:(_,value)=>{raw=value;}};}
test('confirmed stock and prices survive reopening without estimates replacing stock',()=>{
 const disk=storage();cacheSellingData({stock:[{id:1,quantity:72}],stockAt:'confirmed'},disk);cacheSellingData({prices:{full:170,refill:120}},disk);
 assert.equal(readSellingCache(disk).stock[0].quantity,72);assert.equal(readSellingCache(disk).prices.full,170);
});
test('corrupt or unavailable browser storage does not crash startup',()=>{
 assert.equal(readSellingCache({getItem:()=>'{broken'}),null);
 assert.equal(cacheSellingData({stock:[]},{getItem:()=>null,setItem:()=>{throw Error('Full');}}),false);
});

test('prices saved before the first stock refresh are preserved',()=>{
 const disk=storage();cacheSellingData({prices:{full:175,refill:125}},disk);cacheSellingData({stock:[{quantity:10}],stockAt:'confirmed'},disk);
 assert.equal(readSellingCache(disk).prices.full,175);
});
