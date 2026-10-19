// Schedule after completion so a slow request never overlaps its next refresh.
export function startBackgroundPolling({task, onError, online = () => true, schedule = setTimeout, cancel = clearTimeout, interval = 5000}) {
  let stopped = false, timer, failures = 0;
  const run = async () => {
    if (stopped) return;
    if (online()) {
      try { await task(); failures = 0; }
      catch {
        failures = Math.min(failures + 1, 4);
        if (!stopped) { try { onError(); } catch { /* Reporting cannot break retries. */ } }
      }
    }
    if (!stopped) timer = schedule(run, Math.min(60000, interval * 2 ** failures));
  };
  run();
  return () => { stopped = true; cancel(timer); };
}
