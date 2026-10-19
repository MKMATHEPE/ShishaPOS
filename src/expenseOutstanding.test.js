import {test} from 'node:test';
import assert from 'node:assert/strict';
import {outstandingExpenses} from './expenseOutstanding.js';
test('owed includes every unpaid expense independent of payer or approval',()=>{
 assert.deepEqual(outstandingExpenses([{status:'pending',amount:70,paidBy:'staff'},{status:'approved',amount:120,paidBy:null},{status:'paid',amount:500,paidBy:'staff'},{status:'approved',amount:'30',paidBy:'removed-user'}]),{amount:220,count:3});
});
test('marking reimbursed removes expense and undo payment restores owed',()=>{
 const expense={status:'approved',amount:70};
 assert.equal(outstandingExpenses([expense]).amount,70);
 assert.equal(outstandingExpenses([{...expense,status:'paid'}]).amount,0);
 assert.equal(outstandingExpenses([{...expense,status:'approved'}]).amount,70);
 assert.deepEqual(outstandingExpenses([]),{amount:0,count:0});
});
