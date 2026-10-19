const events = new Set(['error','save_failed','slow_screen','slow_request','page_load']);
const screens = new Set(['pos','delivered','stock','management','settings','login','app']);
const codes = new Set(['runtime_error','unhandled_rejection','react_error','network_error','request_failed','slow_request','slow_screen','page_load','equipment_save_failed','initial_load_failed','tab_refresh_failed','management_refresh_failed','session_dates_failed','planning_history_failed','management_history_failed','comparison_load_failed']);
export function diagnosticRecord(event, screen, code, duration, now = new Date()) {
  if (!events.has(event) || !codes.has(code)) return null;
  return {time:now.toISOString(),event,screen:screens.has(screen)?screen:'app',code,
    duration_ms:Number.isFinite(duration)?Math.min(3600000,Math.max(0,Math.round(duration))):null};
}
export function appendDiagnostic(records, record) {
  return record ? [...records,record].slice(-200) : records;
}

// Retain one event per category/screen in each ten-second window.
export function createDiagnosticGate(windowMs = 10000) {
  const last = new Map();
  return record => {
    const key = `${record.event}/${record.screen}/${record.code}`;
    const now = Date.parse(record.time);
    if (last.has(key) && now - last.get(key) >= 0 && now - last.get(key) < windowMs) return false;
    last.set(key, now);
    if (last.size > 200) last.delete(last.keys().next().value);
    return true;
  };
}
