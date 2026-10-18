import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateReceipt,RECEIPT_LIMIT} from './receiptValidation.js';
test('receipt accepts supported photos up to limit',()=>{for(const type of ['image/jpeg','image/png','image/webp']) assert.doesNotThrow(()=>validateReceipt({type,size:RECEIPT_LIMIT}));});
test('receipt rejects unsafe formats, empty and oversized images',()=>{for(const file of [{type:'image/svg+xml',size:100},{type:'text/html',size:100},{type:'image/jpeg',size:0},{type:'image/jpeg',size:RECEIPT_LIMIT+1}]) assert.throws(()=>validateReceipt(file));});
