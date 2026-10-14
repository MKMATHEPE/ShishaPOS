import { installRuntimeMonitoring } from './monitoringRuntime.js';
import { diagnosticRecord, appendDiagnostic } from './diagnosticModel';
import { supabase } from './supabase';
const KEY = 'chill-pipe:diagnostics';
let screen = 'app';
let installed = false;
let records = [];
let remoteLastSent = 0;
export function recordDiagnostic(event, code, duration) {
  const record = diagnosticRecord(event, screen, code, duration);
  if (!record) return;
  records = appendDiagnostic(records,record);
  try { localStorage.setItem(KEY,JSON.stringify(records)); } catch { /* Diagnostics never block the POS. */ }
  // The reviewed monitoring database setup is activated; deployments may opt out.
  if (import.meta.env.VITE_DIAGNOSTICS_REMOTE !== 'false' && supabase && Date.now()-remoteLastSent>10000) {
    remoteLastSent=Date.now();
    supabase.rpc('record_pos_diagnostic',{event_name:record.event,screen_name:record.screen,error_code:record.code,elapsed_ms:record.duration_ms}).then(()=>{},()=>{});
  }
}
export function setDiagnosticScreen(value) { screen=value; }
export async function downloadDiagnostics() {
  let remote = [];
  if (supabase && import.meta.env.VITE_DIAGNOSTICS_REMOTE !== 'false') {
    try {
      const {data} = await supabase.from('pos_diagnostics').select('recorded_at,event,screen,code,duration_ms').order('recorded_at',{ascending:false}).limit(200);
      remote = data ?? [];
    } catch { /* Local export remains available offline. */ }
  }
  const blob = new Blob([JSON.stringify({exportedAt:new Date().toISOString(),events:records,remoteEvents:remote},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='chill-pipe-diagnostics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function installMonitoring() {
  if(installed) return; installed=true;
  try {
    const cached=JSON.parse(localStorage.getItem(KEY)??'[]');
    if(Array.isArray(cached)) records=cached.flatMap(row=>{
      const clean=diagnosticRecord(row.event,row.screen,row.code,row.duration_ms,new Date(row.time));
      return clean?[clean]:[];
    }).slice(-200);
  } catch { records=[]; }
  installRuntimeMonitoring(window, recordDiagnostic, performance);
}
