import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedExpenseTotal } from './expenseApprovalTotals.js';

test('pending manager expenses do not reduce available funds', () => {
  assert.equal(1000 - approvedExpenseTotal([{status:'pending', amount:200, paidBy:'manager'}]), 1000);
});
test('approval deducts the expense and marking it paid does not deduct twice', () => {
  const expense = {status:'approved', amount:200, paidBy:'manager'};
  assert.equal(1000 - approvedExpenseTotal([expense]), 800);
  assert.equal(1000 - approvedExpenseTotal([{...expense, status:'paid'}]), 800);
});
test('settled legacy expenses stay deducted while pending amounts are excluded', () => {
  assert.equal(approvedExpenseTotal([{status:'paid', amount:'150'}, {status:'approved', amount:50}, {status:'pending', amount:300}]), 200);
});
