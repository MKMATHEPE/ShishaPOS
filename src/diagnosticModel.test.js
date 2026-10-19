import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticRecord,appendDiagnostic,createDiagnosticGate} from './diagnosticModel.js';
test('an error burst cannot flood diagnostics, while new failures and later repeats remain visible',()=>{
 const accept=createDiagnosticGate();
 const row={event:'error',screen:'management',code:'unhandled_rejection',time:'2026-10-19T20:55:56.499Z'};
 assert.equal(accept(row),true);
 for(let i=0;i<1000;i++)assert.equal(accept(row),false);
 assert.equal(accept({...row,code:'network_error'}),true);
 assert.equal(accept({...row,screen:'pos'}),true);
 assert.equal(accept({...row,time:'2026-10-19T20:56:06.499Z'}),true);
});
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
