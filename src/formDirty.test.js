import test from 'node:test';
import assert from 'node:assert/strict';
import {formHasChanges} from './formDirty.js';
test('opening blank forms or unchanged prefilled editors is not dirty',()=>{
 assert.equal(formHasChanges({amount:'',date:'2026-10-18'},{amount:'',date:'2026-10-18'}),false);
 assert.equal(formHasChanges({quantity:'1.5'},{quantity:1.5}),false);
});
test('entering a value or changing a selection is dirty; reverting clears it',()=>{
 assert.equal(formHasChanges({amount:'70'},{amount:''}),true);
 assert.equal(formHasChanges({category:'Coal'},{category:'Transport'}),true);
 assert.equal(formHasChanges({amount:''},{amount:''}),false);
});
test('stock counts are dirty only after quantities actually change',()=>{
 assert.equal(formHasChanges({'14:mc':'2'},{'14:mc':'2'}),false);
 assert.equal(formHasChanges({'14:mc':'0'},{'14:mc':'2'}),true);
});
