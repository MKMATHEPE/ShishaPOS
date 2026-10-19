import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expensePersonLabel } from './expensePersonLabel.js';
test('business account is displayed as Business',()=>{
  assert.equal(expensePersonLabel('MKMATHEPE'),'Business');
  assert.equal(expensePersonLabel(' mkmathepe '),'Business');
});
test('other people and missing names remain unchanged',()=>{
  assert.equal(expensePersonLabel('Shibu'),'Shibu');
  assert.equal(expensePersonLabel('Koki'),'Koki');
  assert.equal(expensePersonLabel(undefined),undefined);
});
