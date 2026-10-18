import test from 'node:test';
import assert from 'node:assert/strict';
import {canManageExpense} from './expensePermissions.js';
test('only submitter or admin can manage an expense',()=>{
 const expense={submittedBy:'a',paidBy:'b'};
 assert.equal(canManageExpense(expense,'a',false),true);
 assert.equal(canManageExpense(expense,'b',false),false);
 assert.equal(canManageExpense(expense,'c',false),false);
 assert.equal(canManageExpense(expense,'c',true),true);
 assert.equal(canManageExpense(expense,null,true),false);
});
test('legacy expenses use recorded payer if submitter is missing',()=>{
 assert.equal(canManageExpense({paidBy:'a'},'a',false),true);
 assert.equal(canManageExpense({},'a',false),false);
});
