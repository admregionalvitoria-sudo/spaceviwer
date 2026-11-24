// SpaceViewer v3.0.2
// ============================================================
// SpaceViewer — Windows Task Scheduler Autostart Helper
// Elevated applications cannot start via the Run key; they require
// a scheduled task running ONLOGON with HIGHEST run level.
// ============================================================

import { app } from 'electron';
import { execFile } from 'child_process';

/**
 * Configure autostart via Windows Task Scheduler.
 * Only applied when packaged on win32.
 */
export async function setAutostart(enabled: boolean): Promise<void> {
  if (process.platform !== 'win32' || !app.isPackaged) return;

  // Clean legacy Run key entry created by earlier versions
  try {
    app.setLoginItemSettings({ openAtLogin: false });
  } catch (err) {
    console.warn('[Autostart] Failed to clean legacy login item:', err);
  }

  const taskName = 'SpaceViewer';

  if (enabled) {
    const taskRun = `"${process.execPath}" --autostart`;
    const args = ['/Create', '/F', '/TN', taskName, '/TR', taskRun, '/SC', 'ONLOGON', '/RL', 'HIGHEST', '/IT'];
    return new Promise((resolve) => {
      execFile('schtasks.exe', args, { windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          console.error('[Autostart] Failed to create scheduled task:', err, stderr || stdout);
        } else {
          console.log('[Autostart] Successfully registered scheduled task');
        }
        resolve();
      });
    });
  } else {
    const args = ['/Delete', '/F', '/TN', taskName];
    return new Promise((resolve) => {
      execFile('schtasks.exe', args, { windowsHide: true }, () => {
        // Ignore "not found" / exit code errors
        resolve();
      });
    });
  }
}
