import test from 'node:test';
import assert from 'node:assert/strict';
import { planWeekend } from './purchasePlanner.js';
const usage = { Coal: 2, flavours: { lk: 1 / 3.5 } };
const packs = { Coal: { size: 72, plural: 'boxes' } };
const now = new Date('2026-10-13T10:00:00Z');
const sale = (id, time, status = 'delivered') => ({ id, time, status, flavour: { id: 'lk' } });
test('targets upcoming Friday through Tuesday in Johannesburg', () => {
 const plan = planWeekend([], [], usage, packs, now);
 assert.equal(plan.from, '2026-10-16'); assert.equal(plan.to, '2026-10-20'); assert.equal(plan.first, null);
});
test('uses complete weekday history, excluding today and cancelled orders', () => {
 const orders = [sale(1,'2026-10-02T12:00Z'), sale(2,'2026-10-09T12:00Z'), sale(3,'2026-10-13T08:00Z'), sale(4,'2026-10-10T12:00Z','cancelled')];
 const plan = planWeekend([{name:'Coal', quantity:0,unit:'pieces'}], orders, usage, packs, now);
 assert.equal(plan.forecast, 1); assert.equal(plan.items[0].needed, 2); assert.equal(plan.items[0].buy, 1); assert.equal(plan.items[0].purchaseQuantity,72);
});
test('subtracts available stock before rounding purchases', () => {
 const orders = Array.from({length:10},(_,i)=>sale(i,'2026-10-09T12:00Z'));
 const plan = planWeekend([{name:'Coal',quantity:25,unit:'pieces'},{name:'Flavour',subItems:[{id:'lk',name:'Lady Killer',quantity:1}]}],orders,usage,packs,now);
 assert.equal(plan.items.find(i=>i.name==='Coal').buy,0);
 assert.equal(plan.items.find(i=>i.id==='lk').buy,3);
});
test('converts UTC late-night sales to the local weekday', () => {
 const plan=planWeekend([], [sale(1,'2026-10-08T23:00Z')],usage,packs,now);
 assert.equal(plan.first,'2026-10-09'); assert.equal(plan.forecast,1.25);
});

test('includes Tuesday demand in the five-day forecast', () => {
 const orders = [sale(1,'2026-10-06T12:00Z'),sale(2,'2026-10-06T13:00Z')];
 const plan = planWeekend([{name:'Coal',quantity:0,unit:'pieces'}],orders,usage,packs,now);
 assert.equal(plan.forecast,2); assert.equal(plan.items[0].needed,4);
});
