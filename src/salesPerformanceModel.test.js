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
