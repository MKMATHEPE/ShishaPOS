import test from 'node:test';
import assert from 'node:assert/strict';
import { estimatedStock } from './offlineStock.js';
const stock=[{name:'Coal',category:'consumable',quantity:3},{name:'Mouth Pieces',category:'consumable',quantity:4},{name:'Flavour',category:'consumable',subItems:[{id:'lk',name:'Lady Killer',quantity:1.5}]},{name:'Hookah',category:'equipment',quantity:20}];
test('pending sales estimate consumables without mutating server stock or equipment',()=>{
 const result=estimatedStock(stock,[{flavour:'Lady Killer'}]);
 assert.equal(result[0].quantity,1);assert.equal(result[1].quantity,2);assert.equal(result[2].subItems[0].quantity,1.214);assert.equal(result[3].quantity,20);assert.equal(stock[0].quantity,3);
});
test('estimates stay nonnegative and reconcile when the queue clears',()=>{
 assert.equal(estimatedStock(stock,[{flavour:'Lady Killer'},{flavour:'Lady Killer'}])[0].quantity,0);
 assert.deepEqual(estimatedStock(stock,[]),stock);
});
