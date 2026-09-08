// ============================================================
// ScreenFlow — Application Projector Module
// ============================================================

import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { exec } from 'child_process';
import type { ProjectorState } from '../shared/types';

interface ProjectorEntry {
  win: BrowserWindow;
  sourceId: string;
  appName: string;
  displayId: string;
}

const activeProjectors = new Map<string, ProjectorEntry>();
const windowProjectorParams = new Map<number, { sourceId: string; appName: string; displayId: string }>();
let onProjectorsChangeCb: (() => void) | null = null;

export function setProjectorChangeListener(cb: () => void) {
  onProjectorsChangeCb = cb;
}

export function getProjectorParamsForWindow(webContentsId: number) {
  return windowProjectorParams.get(webContentsId) || null;
}

function notifyChange() {
  if (onProjectorsChangeCb) {
    onProjectorsChangeCb();
  }
}

/**
 * Starts a fullscreen projector of an application onto a target display.
 */
export async function startAppProjector(
  sourceId: string,
  appName: string,
  displayId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const displays = screen.getAllDisplays();
    const targetDisplay = displays.find(
      (d) => d.id.toString() === displayId || (d.id === screen.getPrimaryDisplay().id && displayId === 'primary')
    ) || displays[0];

    if (!targetDisplay) {
      return { success: false, error: `Display ${displayId} not found` };
    }

    // If a projector already exists on this display, close it first
    const existing = activeProjectors.get(displayId);
    if (existing) {
      try {
        existing.win.destroy();
      } catch {}
      activeProjectors.delete(displayId);
    }

    console.log(`[Projector] Launching projector for "${appName}" on Display ${displayId} (${targetDisplay.bounds.width}x${targetDisplay.bounds.height})`);

    const win = new BrowserWindow({
      x: targetDisplay.bounds.x,
      y: targetDisplay.bounds.y,
      width: targetDisplay.bounds.width,
      height: targetDisplay.bounds.height,
      frame: false,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      skipTaskbar: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        webSecurity: false,
      },
    });

    const queryParams = new URLSearchParams({
      projector: 'true',
      sourceId,
      appName,
      displayId,
    });

    // Store in params map so the window can also fetch its params directly via IPC
    windowProjectorParams.set(win.webContents.id, {
      sourceId,
      appName,
      displayId,
    });

    const hashParams = queryParams.toString();

    // Use hash instead of search parameter to avoid Chromium file:// asar ERR_FAILED (-2) bug
    if (process.env.ELECTRON_RENDERER_URL) {
      const url = `${process.env.ELECTRON_RENDERER_URL}#${hashParams}`;
      await win.loadURL(url);
    } else {
      const filePath = path.join(__dirname, '../renderer/index.html');
      await win.loadFile(filePath, {
        hash: hashParams,
      });
    }

    // Position precisely on the target display and maximize borderless
    win.setBounds(targetDisplay.bounds);
    win.setFullScreen(true);
    win.show();

    activeProjectors.set(displayId, {
      win,
      sourceId,
      appName,
      displayId,
    });

    win.on('closed', () => {
      windowProjectorParams.delete(win.webContents.id);
      activeProjectors.delete(displayId);
      notifyChange();
    });

    notifyChange();
    return { success: true };
  } catch (err: any) {
    console.error('[Projector] Failed to start projector:', err);
    return { success: false, error: err?.message || 'Failed to start projector' };
  }
}

// Backward compatibility alias
export const startObsProjector = startAppProjector;

/**
 * Stops an active application projector on a specific display or all displays.
 */
export async function stopAppProjector(displayId?: string): Promise<{ success: boolean }> {
  try {
    if (displayId) {
      const entry = activeProjectors.get(displayId);
      if (entry) {
        entry.win.destroy();
        activeProjectors.delete(displayId);
      }
    } else {
      activeProjectors.forEach((entry) => {
        try {
          entry.win.destroy();
        } catch {}
      });
      activeProjectors.clear();
    }
    notifyChange();
    return { success: true };
  } catch (err) {
    console.error('[Projector] Failed to stop projector:', err);
    return { success: false };
  }
}

// Backward compatibility alias
export const stopObsProjector = stopAppProjector;

/**
 * Returns all currently active projectors mapped by displayId.
 */
export function getActiveProjectors(): ProjectorState {
  const result: ProjectorState = {};
  activeProjectors.forEach((entry, dispId) => {
    result[dispId] = {
      sourceId: entry.sourceId,
      appName: entry.appName,
    };
  });
  return result;
}

/**
 * Moves a native Windows application window to the target display coordinates.
 */
export async function moveWindowToScreen(
  windowName: string,
  displayId: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const displays = screen.getAllDisplays();
    const targetDisplay = displays.find((d) => d.id.toString() === displayId) || displays[0];
    if (!targetDisplay) {
      return resolve({ success: false, error: 'Display not found' });
    }

    const { x, y, width, height } = targetDisplay.bounds;
    // PowerShell script to locate window by title snippet and move/maximize it
    const escapedTitle = windowName.replace(/'/g, "''").replace(/[\[\]]/g, '');
    const psScript = `
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  }
"@
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${escapedTitle.slice(0, 20)}*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($proc) {
  [Win32]::ShowWindow($proc.MainWindowHandle, 9)
  [Win32]::SetWindowPos($proc.MainWindowHandle, [IntPtr]::Zero, ${x}, ${y}, ${width}, ${height}, 0x0040)
  Write-Output "OK"
} else {
  Write-Output "NOT_FOUND"
}
`;

    exec(`powershell -NoProfile -NonInteractive -Command "${psScript.replace(/\r?\n/g, ' ')}"`, (err, stdout) => {
      if (err) {
        console.warn('[Projector] Move window error:', err);
        return resolve({ success: false, error: err.message });
      }
      if (stdout.includes('OK')) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: 'Janela do aplicativo não encontrada para movimentação' });
      }
    });
  });
}
