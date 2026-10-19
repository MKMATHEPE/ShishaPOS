import {test} from 'node:test';
import assert from 'node:assert/strict';
import {partnerProfitSplit} from './partnerProfitSplit.js';
test('profit shares subtract recorded payments only from the correct partner',()=>{
 const result=partnerProfitSplit(1000,[{profileId:'a',profitShare:60},{profileId:'b',profitShare:40}],[{profileId:'a',amount:100}]);
 assert.deepEqual(result.rows,[{profileId:'a',percentage:60,share:600,paid:100,remaining:500},{profileId:'b',percentage:40,share:400,paid:0,remaining:400}]);
});
test('equal split allocates cents exactly and losses do not create payouts',()=>{
 const partners=['a','b','c'].map(profileId=>({profileId,profitShare:0}));
 assert.deepEqual(partnerProfitSplit(100,partners).rows.map(row=>row.share),[33.34,33.33,33.33]);
 assert.equal(partnerProfitSplit(-10,partners).rows.reduce((sum,row)=>sum+row.remaining,0),0);
});
test('missing and invalid partner settings are reported instead of inventing shares',()=>{
 assert.ok(partnerProfitSplit(100,[]).error);
 assert.ok(partnerProfitSplit(100,[{profileId:'a',profitShare:60}]).error);
 assert.ok(partnerProfitSplit(100,[{profileId:'a',profitShare:-10},{profileId:'b',profitShare:110}]).error);
});
