// A fire-and-forget read must settle even when the connection or reporting fails.
export async function runBackgroundTask(task, code, report) {
  try {
    await task();
    return true;
  } catch {
    try { report('error', code); } catch { /* Reporting cannot cause another failure. */ }
    return false;
  }
}
