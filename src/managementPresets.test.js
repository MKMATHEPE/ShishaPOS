import test from 'node:test';
import assert from 'node:assert/strict';
import {presetRange,presetIsActive} from './managementPresets.js';
const now=new Date('2026-10-15T12:00:00Z');
test('all four presets highlight when their full-day range is selected',()=>{
 for(const preset of ['Today','Yesterday','7 Days','Month']) {
  const r=presetRange(preset,now);assert.equal(presetIsActive(preset,preset,r.from,r.to,'00:00','23:59',now),true);
 }
});
test('overlapping ranges highlight only the explicitly selected button',()=>{
 const first=new Date('2026-11-01T12:00:00Z');
 assert.equal(presetIsActive('Today','Month','2026-11-01','2026-11-01','00:00','23:59',first),false);
 assert.equal(presetIsActive('Month','Month','2026-11-01','2026-11-01','00:00','23:59',first),true);
});
test('custom dates or hours remove the preset highlight',()=>{
 assert.equal(presetIsActive('Today','Today','2026-10-14','2026-10-15','00:00','23:59',now),false);
 assert.equal(presetIsActive('Today','Today','2026-10-15','2026-10-15','10:00','23:59',now),false);
});
test('uses Johannesburg date across UTC midnight and month boundaries',()=>{
 assert.deepEqual(presetRange('Yesterday',new Date('2026-10-31T22:30:00Z')),{from:'2026-10-31',to:'2026-10-31'});
 assert.deepEqual(presetRange('7 Days',new Date('2026-11-03T12:00:00Z')),{from:'2026-10-28',to:'2026-11-03'});
});
