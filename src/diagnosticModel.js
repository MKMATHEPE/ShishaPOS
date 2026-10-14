const events = new Set(['error','save_failed','slow_screen','slow_request','page_load']);
const screens = new Set(['pos','delivered','stock','management','settings','login','app']);
const codes = new Set(['runtime_error','unhandled_rejection','react_error','network_error','request_failed','slow_request','slow_screen','page_load','equipment_save_failed']);
export function diagnosticRecord(event, screen, code, duration, now = new Date()) {
  if (!events.has(event) || !codes.has(code)) return null;
  return {time:now.toISOString(),event,screen:screens.has(screen)?screen:'app',code,
    duration_ms:Number.isFinite(duration)?Math.min(3600000,Math.max(0,Math.round(duration))):null};
}
export function appendDiagnostic(records, record) {
  return record ? [...records,record].slice(-200) : records;
}
