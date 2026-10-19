import test from 'node:test';
import {setImmediate} from 'node:timers';
import assert from 'node:assert/strict';
import {startBackgroundPolling} from './backgroundPolling.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(task) {
  let connected = true, timer, errors = 0;
  const stop = startBackgroundPolling({task, online:()=>connected, onError:()=>errors++, schedule:(run,delay)=>(timer={run,delay}), cancel:()=>{timer=null;}});
  return {stop, disconnect:()=>{connected=false;}, reconnect:()=>{connected=true;}, get timer(){return timer;}, get errors(){return errors;}, tick:async()=>{const next=timer;timer=null;await next.run();}};
}
test('slow refreshes never overlap and stopping prevents further scheduling',async()=>{
  let resolve, calls=0;
  const h=harness(()=>{calls++;return new Promise(done=>{resolve=done;});});
  assert.equal(calls,1);assert.equal(h.timer,undefined);
  h.stop();resolve();await flush();assert.equal(h.timer,null);
});
test('repeated failures back off and recovery restores normal refresh frequency',async()=>{
  let failed=true,calls=0;
  const h=harness(async()=>{calls++;if(failed)throw Error('Disconnected');});
  await flush();assert.equal(h.timer.delay,10000);
  await h.tick();assert.equal(h.timer.delay,20000);
  await h.tick();assert.equal(h.timer.delay,40000);
  await h.tick();assert.equal(h.timer.delay,60000);
  failed=false;await h.tick();assert.equal(h.timer.delay,5000);
  assert.equal(calls,5);assert.equal(h.errors,4);h.stop();
});
test('offline refreshes make no request and resume after reconnecting',async()=>{
  let calls=0;const h=harness(async()=>{calls++;});await flush();
  h.disconnect();await h.tick();await h.tick();assert.equal(calls,1);
  h.reconnect();await h.tick();assert.equal(calls,2);h.stop();
});
