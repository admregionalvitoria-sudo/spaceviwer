import { app } from 'electron';
import * as os from 'os';

let lastRaised = 0;

/**
 * Raises process priority of all app processes to PRIORITY_ABOVE_NORMAL
 * to prevent frame drops or throttle during capture/encode when the window is hidden/occluded.
 * Throttled to at most once per 5 seconds.
 */
export function raiseAppPriority(): void {
  const now = Date.now();
  if (now - lastRaised < 5000) {
    return;
  }
  lastRaised = now;

  try {
    const priority = os.constants?.priority?.PRIORITY_ABOVE_NORMAL ?? -10;
    const pids = new Set<number>();
    pids.add(process.pid);

    const metrics = app.getAppMetrics();
    for (const metric of metrics) {
      if (metric.pid) {
        pids.add(metric.pid);
      }
    }

    for (const pid of pids) {
      try {
        os.setPriority(pid, priority);
      } catch {
        // Individual process may have exited or reject priority adjustment
      }
    }
  } catch (err) {
    console.warn('[ProcessPriority] Failed to raise app priority:', err);
  }
}
