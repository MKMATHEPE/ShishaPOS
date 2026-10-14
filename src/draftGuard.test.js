import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftGuard} from './draftGuard.js';
test('clean screens navigate without showing a discard prompt',()=>{
 const guard=createDraftGuard(); assert.equal(guard.confirm(()=>{throw Error('Unexpected prompt');}),true);
});
test('cancelling navigation retains the unsaved draft',()=>{
 const guard=createDraftGuard();guard.set('stock',true);
 assert.equal(guard.confirm(()=>false),false); assert.equal(guard.hasChanges(),true);
});
test('discard approval permits navigation without clearing another mounted draft',()=>{
 const guard=createDraftGuard();guard.set('expense',true);guard.set('equipment',true);
 assert.equal(guard.confirm(()=>true),true);guard.set('expense',false);
 assert.equal(guard.hasChanges(),true);guard.set('equipment',false);assert.equal(guard.hasChanges(),false);
});
test('reload is blocked only while a draft exists and recovers after save',()=>{
 const guard=createDraftGuard();let blocked=0;const event={preventDefault(){blocked++;}};
 guard.beforeUnload(event);assert.equal(blocked,0);
 guard.set('count',true);guard.beforeUnload(event);assert.equal(blocked,1);assert.equal(event.returnValue,'');
 guard.set('count',false);guard.beforeUnload(event);assert.equal(blocked,1);
});

test('asynchronous in-app confirmation can cancel or approve without clearing drafts prematurely',async()=>{
 const guard=createDraftGuard();guard.set('finance',true);
 let resolve;const pending=guard.confirm(()=>new Promise(done=>{resolve=done;}));
 assert.equal(guard.hasChanges(),true);resolve(false);assert.equal(await pending,false);
 assert.equal(guard.hasChanges(),true);assert.equal(await guard.confirm(async()=>true),true);
 guard.set('finance',false);assert.equal(guard.hasChanges(),false);
});
