import test from 'node:test';
import assert from 'node:assert/strict';
import { expenseChanges, expenseDate } from './expenseEditor.js';
const expense={time:'2026-10-12T22:30:00Z',amount:100};
const draft={date:'2026-10-13',category:'Transport',description:' Taxi ',amount:'150.50',paidBy:''};
test('uses Johannesburg date and preserves timestamp for same-day edits',()=>{
 assert.equal(expenseDate(expense.time),'2026-10-13');
 assert.equal(expenseChanges(expense,draft,null,'2026-10-13').time,expense.time);
});
test('cannot move a locked expense to an unlocked date',()=>{
 assert.throws(()=>expenseChanges(expense,{...draft,date:'2026-10-14'},'2026-10-13','2026-10-14'),/locked/);
});
test('cannot move an unlocked expense into a locked period',()=>{
 assert.throws(()=>expenseChanges(expense,{...draft,date:'2026-10-11'},'2026-10-11','2026-10-13'),/locked/);
});
test('rejects invalid amounts and dates',()=>{
 for(const amount of ['0','-1','Infinity','NaN']) assert.throws(()=>expenseChanges(expense,{...draft,amount},null,'2026-10-13'),/amount/);
 assert.throws(()=>expenseChanges(expense,{...draft,date:'2026-02-30'},null,'2026-10-13'),/date/);

});
test('normalizes edited values and uses noon Johannesburg for a changed date',()=>{
 const changes=expenseChanges(expense,{...draft,date:'2026-10-12'},null,'2026-10-13');
 assert.equal(changes.time,'2026-10-12T10:00:00.000Z');assert.equal(changes.amount,150.5);assert.equal(changes.paidBy,null);assert.equal(changes.description,'Taxi');
});

test('editing a stock purchase keeps a positive linked quantity',()=>{
 const changes=expenseChanges(expense,{...draft,stockKey:'14:lk',stockQuantity:'3'},null,'2026-10-13');
 assert.deepEqual(changes.stockQuantities,{'14:lk':3});
 assert.throws(()=>expenseChanges(expense,{...draft,stockKey:'14:lk',stockQuantity:'0'},null,'2026-10-13'),/quantity/);
});
test('removing a stock link sends an empty purchase map for reversal',()=>{
 const changes=expenseChanges({...expense,stockQuantities:{'14:lk':3}},{...draft,stockKey:'',stockQuantity:''},null,'2026-10-13');
 assert.deepEqual(changes.stockQuantities,{});
});

test('expense descriptions are optional and accept arbitrary free text',()=>{
 for(const description of ['', '   ', undefined, 'Any note, not a database item']) {
  const changes=expenseChanges(expense,{...draft,description},null,'2026-10-13');
  assert.equal(changes.description,(description ?? '').trim());
 }
});
