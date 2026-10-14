import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticRecord,appendDiagnostic} from './diagnosticModel.js';
test('rejects messages and URLs as diagnostic codes',()=>{
 assert.equal(diagnosticRecord('error','management','Password: secret'),null);
 assert.equal(diagnosticRecord('error','management','https://example.com?token=secret'),null);
});
test('stores only allowlisted metadata and bounds duration',()=>{
 const row=diagnosticRecord('error','arbitrary customer name','runtime_error',5000000,new Date('2026-10-14T10:00:00Z'));
 assert.deepEqual(row,{time:'2026-10-14T10:00:00.000Z',event:'error',screen:'app',code:'runtime_error',duration_ms:3600000});
});
test('diagnostics remain bounded and ignore invalid events',()=>{
 const events=Array.from({length:200},(_,i)=>i);
 assert.deepEqual(appendDiagnostic(events,200),Array.from({length:200},(_,i)=>i+1));
 assert.deepEqual(appendDiagnostic(events,null),events);
});
