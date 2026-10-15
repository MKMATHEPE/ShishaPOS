import test from 'node:test';
import assert from 'node:assert/strict';
import {monthBounds,monthlyWeeks,tradingMonthBounds} from './monthlyWeeks.js';
test('weeks start on Saturdays and finish Tuesday at 02:00 Johannesburg time',()=>{
 const {weeks}=monthlyWeeks('2026-10',[],new Date('2026-10-15T10:00:00Z'));
 assert.deepEqual(weeks.map(w=>[w.from,w.to]),[['2026-10-03','2026-10-06'],['2026-10-10','2026-10-13'],['2026-10-17','2026-10-20'],['2026-10-24','2026-10-27'],['2026-10-31','2026-11-03']]);
 assert.deepEqual(weeks.map(w=>w.status),['Complete','Complete','Upcoming','Upcoming','Upcoming']);
});
test('includes Tuesday before 2am, excludes the cutoff and closed weekdays',()=>{
 const orders=[{time:'2026-10-03T00:00:00+02:00',price:100},{time:'2026-10-06T01:59:59+02:00',price:300},{time:'2026-10-06T02:00:00+02:00',price:900},{time:'2026-10-09T23:59:59+02:00',price:900},{time:'2026-10-03T12:00:00+02:00',price:500,status:'cancelled'},{time:'2026-10-03T12:00:00+02:00',price:500,pendingSync:true}];
 const {weeks,total}=monthlyWeeks('2026-10',orders,new Date('2026-11-05T00:00:00Z'));
 assert.equal(total,400);assert.equal(weeks[0].orders,2);assert.equal(weeks[0].share,100);
});
test('month-end trading sessions remain with their Saturday month and fetch through Tuesday',()=>{
 const order={time:'2026-11-03T01:00:00+02:00',price:170};
 assert.equal(monthlyWeeks('2026-10',[order],new Date('2026-11-04T00:00:00Z')).total,170);
 assert.equal(monthlyWeeks('2026-11',[order],new Date('2026-11-04T00:00:00Z')).total,0);
 assert.equal(tradingMonthBounds('2026-10').to,'2026-11-03T00:00:00.000Z');
});
test('current period becomes complete precisely at Tuesday 02:00',()=>{
 assert.equal(monthlyWeeks('2026-10',[],new Date('2026-10-06T01:59:59+02:00')).weeks[0].status,'Incomplete');
 assert.equal(monthlyWeeks('2026-10',[],new Date('2026-10-06T02:00:00+02:00')).weeks[0].status,'Complete');
});
test('handles leap February and empty trading months',()=>{
 assert.equal(monthBounds('2028-02').to,'2028-02-29');
 assert.equal(monthlyWeeks('2026-03',[]).weeks.length,4);
 assert.ok(monthlyWeeks('2026-03',[]).weeks.every(w=>w.share===0));
});
