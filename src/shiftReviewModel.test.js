import test from 'node:test';
import assert from 'node:assert/strict';
import {buildShiftReview,validReviewAmount} from './shiftReviewModel.js';
const input={start:{closed_at:'2026-10-18T15:00:00Z',closing:{'14:lk':3,'1':72}},end:{closed_at:'2026-10-19T22:00:00Z',closing:{'14:lk':1,'1':60}},lines:[{key:'14:lk',name:'Lady Killer',flavour:{}},{key:'1',name:'Coal'}],trackingStart:'2026-10-01T00:00:00Z',orders:Array.from({length:6},(_,id)=>({id,flavour:'Lady Killer',time:'2026-10-18T18:00:00Z',price:170,payment:'cash'}))};
test('physical counts produce flavour ranges and independent coal usage',()=>{
 const result=buildShiftReview(input);assert.equal(result.flavours[0].used,2);assert.equal(result.flavours[0].low,6);assert.equal(result.flavours[0].high,7);assert.equal(result.flavours[0].status,'Within range');assert.equal(result.coal.difference,0);assert.equal(result.payments.cash,1020);
});
test('stock receipts, purchase edits and reversals count once by movement time',()=>{
 const result=buildShiftReview({...input,movements:[{recorded_at:'2026-10-18T19:00:00Z',quantities:{'14:lk':2}},{recorded_at:'2026-10-18T20:00:00Z',quantities:{'14:lk':-1}}],expenses:[{created_at:'2026-10-18T19:00:00Z',stock_quantities:{'14:lk':100}}]});assert.equal(result.flavours[0].used,3);assert.equal(result.flavours[0].status,'Review difference');
});
test('historical purchases cannot be presented as verified discrepancies',()=>{
 const result=buildShiftReview({...input,trackingStart:'2026-10-20T00:00:00Z'});assert.equal(result.tracked,false);assert.equal(result.flavours[0].status,'Estimate only');assert.equal(result.coal.reliable,false);
});
test('missing counts, negative usage and corrections never imply normal usage',()=>{
 assert.equal(buildShiftReview({...input,end:{...input.end,closing:{}}}).flavours[0].status,'Check counts');
 assert.equal(buildShiftReview({...input,end:{...input.end,closing:{'14:lk':10}}}).flavours[0].low,null);
 assert.equal(buildShiftReview({...input,receipts:[{recorded_at:'2026-10-18T18:00:00Z',kind:'adjust',counts:{'14:lk':2}}]}).flavours[0].status,'Estimate only');
});
test('intervals exclude opening boundary, cancellations and pending sales; closing boundary included',()=>{
 const orders=[input.orders[0],{...input.orders[0],status:'cancelled'},{...input.orders[0],pendingSync:true},{...input.orders[0],time:input.start.closed_at},{...input.orders[0],time:input.end.closed_at}];assert.equal(buildShiftReview({...input,orders}).orders,2);assert.throws(()=>buildShiftReview({...input,start:input.end}));
});
test('blank actual payments stay missing; zero is valid and invalid money is rejected',()=>{
 for(const value of ['',0,'0','100.50'])assert.equal(validReviewAmount(value),true);
 for(const value of [' ',null,undefined,-1,'1.001','abc',Infinity])assert.equal(validReviewAmount(value),false);
});
