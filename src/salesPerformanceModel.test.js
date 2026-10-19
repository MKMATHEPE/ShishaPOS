import {test} from 'node:test';
import assert from 'node:assert/strict';
import {salesDays,salesInsights} from './salesPerformanceModel.js';
test('daily sales use South African dates and include zero-sale days',()=>{
 const rows=salesDays([{time:'2026-10-17T23:30:00Z',price:170},{time:'2026-10-18T10:00:00Z',price:120}],['2026-10-17','2026-10-18']);
 assert.deepEqual(rows,[{date:'2026-10-17',revenue:0,orders:0},{date:'2026-10-18',revenue:290,orders:2}]);
 assert.equal(salesInsights(rows,'revenue').average,145);
 assert.equal(salesInsights(rows,'orders').average,1);
});
test('best day follows selected measure and empty periods have no best day',()=>{
 const rows=[{date:'a',revenue:200,orders:1},{date:'b',revenue:150,orders:2}];
 assert.equal(salesInsights(rows,'revenue').best.date,'a');
 assert.equal(salesInsights(rows,'orders').best.date,'b');
 assert.deepEqual(salesInsights([],'orders'),{best:null,average:0});
 assert.equal(salesInsights([{date:'a',revenue:0,orders:0}],'revenue').best,null);
});

test('running profit starts from zero, includes pending expenses and manual sales, and can fall below zero',async()=>{
 const {profitDays}=await import('./salesPerformanceModel.js');
 const rows=profitDays([{time:'2026-10-18T12:00:00+02:00',price:170}], [{time:'2026-10-18T10:00:00+02:00',amount:200,status:'pending'},{time:'2026-10-19T12:00:00+02:00',amount:20,status:'paid'},{time:'2026-10-17T12:00:00+02:00',amount:999}], [{date:'2026-10-19',amount:100}], ['2026-10-18','2026-10-19','2026-10-20']);
 assert.deepEqual(rows.map(row=>row.profit),[-30,50,50]);
 assert.deepEqual(rows.map(row=>row.dailyProfit),[-30,80,0]);
 assert.equal(rows.at(-1).profit,rows.reduce((sum,row)=>sum+row.received-row.expenses,0));
});

test('profit months cover three full months across year and leap boundaries',async()=>{
 const {profitMonths}=await import('./salesPerformanceModel.js');
 assert.deepEqual(profitMonths('2026-01'),[{month:'2026-01',from:'2026-01-01',to:'2026-01-31'},{month:'2025-12',from:'2025-12-01',to:'2025-12-31'},{month:'2025-11',from:'2025-11-01',to:'2025-11-30'}]);
 assert.equal(profitMonths('2024-03')[1].to,'2024-02-29');
});
