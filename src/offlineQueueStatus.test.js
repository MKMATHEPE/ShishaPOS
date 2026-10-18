import test from 'node:test';
import assert from 'node:assert/strict';
import {blocksSignOut} from './offlineQueueStatus.js';
test('switching users is blocked during saving, syncing, or owned pending sales',()=>{
 assert.equal(blocksSignOut([{ownerId:'a'}],'a'),true);
 assert.equal(blocksSignOut([],'a',true),true);
 assert.equal(blocksSignOut([],'a',false,true),true);
 assert.equal(blocksSignOut([{ownerId:'b'}],'a'),false);
 assert.equal(blocksSignOut([],'a'),false);
});
