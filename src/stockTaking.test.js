import test from 'node:test';
import assert from 'node:assert/strict';
import { stockLines, countPayload, reconcileStock, stockAfterAddition, initialCountDraft } from './stockTakingModel.js';
const stock=[{id:1,name:'Coal',unit:'pieces',quantity:72},{id:2,name:'Flavour',subItems:[{id:'lk',name:'Lady Killer',quantity:2.5}]}];
test('keeps parent and flavour IDs separate',()=>{
 assert.deepEqual(stockLines(stock).map(item=>item.key),['1','2:lk']);
});
test('requires complete physical counts, accepts zero and fractional boxes',()=>{
 const lines=stockLines(stock);
 assert.throws(()=>countPayload(lines,{'1':'0'}),/Lady Killer/);
 assert.deepEqual(countPayload(lines,{'1':'0','2:lk':'0.25'}),{'1':0,'2:lk':0.25});
 assert.throws(()=>countPayload(lines,{'1':'-1','2:lk':'0'}),/valid quantity/);
});
test('additions ignore untouched fields and require a positive amount',()=>{
 assert.deepEqual(countPayload(stockLines(stock),{'1':'72'},true),{'1':72});
 assert.throws(()=>countPayload(stockLines(stock),{'1':'0'},true),/stock to add/);
});
test('reconciliation preserves shortages and surplus without floating point noise',()=>{
 const result=reconcileStock(stockLines(stock),{'1':70,'2:lk':2.8});
 assert.equal(result[0].difference,-2);assert.equal(result[1].difference,0.3);
});

test('buying three boxes adds to one and a half remaining',()=>{
 assert.equal(stockAfterAddition(1.5,3),4.5);
});
test('equipment inventory is listed after consumables',()=>{
 const lines=stockLines([{id:9,name:'Pipe',category:'equipment',unit:'units',quantity:20},...stock]);
 assert.equal(lines.at(-1).name,'Pipe');
});

test('editing one remaining quantity produces a complete save payload',()=>{
 const lines=stockLines([{id:9,name:'Pipe',category:'equipment',unit:'units',quantity:20},...stock]);
 const draft=initialCountDraft(lines);draft['2:lk']='1.5';
 assert.deepEqual(countPayload(lines,draft),{'1':72,'2:lk':1.5,'9':20});
 assert.equal(lines.find(item=>item.key==='2:lk').quantity,2.5);
});
test('untouched zero counts remain zero while cleared edited fields still fail validation',()=>{
 const lines=stockLines([{id:1,name:'Coal',quantity:0,unit:'pieces'}]);
 const draft=initialCountDraft(lines);assert.deepEqual(countPayload(lines,draft),{'1':0});
 draft['1']='';assert.throws(()=>countPayload(lines,draft),/Coal/);
});
