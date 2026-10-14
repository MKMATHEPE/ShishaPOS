import test from 'node:test';
import assert from 'node:assert/strict';
import {saveEquipmentChange} from './equipmentSave.js';
test('display and editor stay unchanged until the database confirms the save',async()=>{
 let resolve;const pending=new Promise(done=>{resolve=done;});const displayed={quantity:2};let closed=false;
 const saving=saveEquipmentChange({quantity:3},()=>pending,item=>{displayed.quantity=item.quantity;closed=true;});
 assert.equal(displayed.quantity,2);assert.equal(closed,false);
 resolve(true);await saving;assert.equal(displayed.quantity,3);assert.equal(closed,true);
});
test('denied or zero-row writes retain the draft and do not update displayed stock',async()=>{
 let accepted=false;await assert.rejects(saveEquipmentChange({quantity:3},async()=>false,()=>{accepted=true;}));assert.equal(accepted,false);
});
test('connection failures leave the editor open without applying changes',async()=>{
 let accepted=false;await assert.rejects(saveEquipmentChange({quantity:3},async()=>{throw Error('offline');},()=>{accepted=true;}),/offline/);assert.equal(accepted,false);
});
