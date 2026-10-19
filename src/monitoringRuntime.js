export function installRuntimeMonitoring(window, report, clock) {
  const record = (...args) => {
    try { report(...args); } catch { /* Preserve the original app/network result. */ }
  };
  window.addEventListener('error',()=>record('error','runtime_error'));
  window.addEventListener('unhandledrejection',()=>record('error','unhandled_rejection'));
  const originalFetch=window.fetch.bind(window);
  window.fetch=async (...args)=>{
    const request=args[0], raw=typeof request==='string'?request:request?.url??String(request);
    const diagnostics=raw.includes('record_pos_diagnostic');
    const start=clock.now();
    try {
      const response=await originalFetch(...args);
      if(!diagnostics) {
        const duration=clock.now()-start;
        if(!response.ok) {
          const method=(args[1]?.method??request?.method??'GET').toUpperCase();
          record(method==='GET'?'error':'save_failed','request_failed',duration);
        }
        else if(duration>2000) record('slow_request','slow_request',duration);
      }
      return response;
    } catch(error) {
      if(!diagnostics && error?.name!=='AbortError') record('error','network_error',clock.now()-start);
      throw error;
    }
  };
  window.addEventListener('load',()=>{
    const entry=clock.getEntriesByType('navigation')[0];
    record('page_load','page_load',entry?.domContentLoadedEventEnd);
  },{once:true});
}
