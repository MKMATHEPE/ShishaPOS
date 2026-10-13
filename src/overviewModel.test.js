import test from 'node:test';
import assert from 'node:assert/strict';
import { previousPeriod, periodRecords, performance, changeLabel, chartTotals } from './overviewModel.js';
test('comparison preserves weekdays without overlapping the selected range',()=>{
 assert.deepEqual(previousPeriod('2026-10-09','2026-10-13'),{from:'2026-10-02',to:'2026-10-06'});
 assert.deepEqual(previousPeriod('2026-10-01','2026-10-13'),{from:'2026-09-17',to:'2026-09-29'});
});
test('filters by Johannesburg dates and hours and excludes cancellations and offline drafts',()=>{
 const orders=[{time:'2026-10-12T22:30:00Z',price:170},{time:'2026-10-13T09:00:00Z',price:120},{time:'2026-10-13T09:00:00Z',price:170,status:'cancelled'},{time:'2026-10-13T09:00:00Z',price:170,pendingSync:true}];
 assert.equal(periodRecords(orders,'2026-10-13','2026-10-13').length,2);
 assert.deepEqual(performance(periodRecords(orders,'2026-10-13','2026-10-13','10:00','12:00')),{revenue:120,orders:1,average:120});
});
test('empty periods have defined averages and comparisons never divide by zero',()=>{
 assert.deepEqual(performance([]),{revenue:0,orders:0,average:0});
 assert.equal(changeLabel(12,0),'No prior sales');
 assert.equal(changeLabel(120,100),'+20%');
});

test('single-pass charts preserve revenue, empty days and all overnight hours',()=>{
 const result=chartTotals([{time:'2026-10-12T22:30:00Z',price:170},{time:'2026-10-13T19:00:00Z',price:120}],['2026-10-13','2026-10-14']);
 assert.deepEqual(result.values,[290,0]);
 assert.equal(result.hours[0].count,1);
 assert.equal(result.hours[10].count,1);
 assert.equal(result.hours.reduce((sum,h)=>sum+h.count,0),2);
});
