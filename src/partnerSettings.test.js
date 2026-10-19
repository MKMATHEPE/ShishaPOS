import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateProfitPartners} from './partnerSettings.js';
test('partner shares must identify distinct accounts and total 100%',()=>{
 assert.equal(validateProfitPartners([{profileId:'a',profitShare:'60'},{profileId:'b',profitShare:'40'}]),'');
 for(const rows of [[],[{profileId:'',profitShare:100}],[{profileId:'a',profitShare:50}],[{profileId:'a',profitShare:0},{profileId:'b',profitShare:100}],[{profileId:'a',profitShare:50},{profileId:'a',profitShare:50}]]) assert.ok(validateProfitPartners(rows));
});
