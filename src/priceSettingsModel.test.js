import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validPrices} from './priceSettingsModel.js';
test('prices accept zero and two decimal rand amounts',()=>{assert.ok(validPrices({full:'175',refill:'120.50'}));assert.ok(validPrices({full:0,refill:0}));});
test('prices reject empty negative nonnumeric and fractional cents',()=>{for(const full of ['',' ','abc',-1,'170.001',Infinity])assert.equal(validPrices({full,refill:120}),false);});
