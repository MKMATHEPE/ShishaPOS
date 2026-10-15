import {zaDay} from './overviewModel.js';
export function presetRange(preset, now = new Date()) {
  const to=zaDay(now), start=new Date(`${to}T00:00:00Z`);
  if(preset==='Yesterday') {start.setUTCDate(start.getUTCDate()-1);const day=start.toISOString().slice(0,10);return {from:day,to:day};}
  if(preset==='7 Days') start.setUTCDate(start.getUTCDate()-6);
  if(preset==='Month') start.setUTCDate(1);
  return {from:start.toISOString().slice(0,10),to};
}
export function presetIsActive(preset, selected, from, to, timeFrom, timeTo, now=new Date()) {
 const range=presetRange(preset,now);
 return preset===selected&&range.from===from&&range.to===to&&timeFrom==='00:00'&&timeTo==='23:59';
}
