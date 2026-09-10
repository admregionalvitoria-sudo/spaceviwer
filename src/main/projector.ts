// SpaceViewer v2.2.9
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
 * Safely executes a PowerShell script on Windows using Base64 UTF-16LE -EncodedCommand.
 * This completely avoids quoting issues, line-break destruction, and here-string syntax errors.
 */
function runPowerShellScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr?.trim() || stdout?.trim() || err.message));
        }
        resolve(stdout?.trim() || '');
      });
    } catch (e: any) {
      reject(e);
    }
  });
}

/**
 * Ensures an application window is restored if it was minimized to the taskbar.
 * Minimized windows in Windows DWM stop rendering their visual buffers, causing
 * Chromium's DesktopCapturer to fail with "Could not start video source".
 */
export async function restoreWindowIfMinimized(sourceId: string, appName: string): Promise<void> {
  if (!sourceId.startsWith('window:')) {
    return;
  }

  try {
    const parts = sourceId.split(':');
    const hwndVal = parseInt(parts[1], 10);
    const escapedTitle = appName.replace(/'/g, "''").replace(/[\[\]]/g, '').slice(0, 20);

    const psScript = `
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class Win32Restorer {
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
  }
"@
$done = $false
${!isNaN(hwndVal) && hwndVal > 0 ? `
try {
  $h = [IntPtr]${hwndVal}
  if ([Win32Restorer]::IsIconic($h)) {
    [Win32Restorer]::ShowWindow($h, 9)
    $done = $true
  }
} catch {}
` : ''}
if (-not $done -and "${escapedTitle}") {
  try {
    $proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${escapedTitle}*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($proc -and [Win32Restorer]::IsIconic($proc.MainWindowHandle)) {
      [Win32Restorer]::ShowWindow($proc.MainWindowHandle, 9)
    }
  } catch {}
}
`;

    await runPowerShellScript(psScript);
    // Allow brief delay for Windows DWM compositor to restore frame buffer
    await new Promise((resolve) => setTimeout(resolve, 200));
  } catch (err) {
    console.warn('[Projector] Failed to restore window if minimized:', err);
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

    // If it's an application window, restore it if minimized so DWM renders it
    if (sourceId.startsWith('window:')) {
      await restoreWindowIfMinimized(sourceId, appName);
    }

    // If a projector already exists on this display, close it safely first
    const existing = activeProjectors.get(displayId);
    if (existing) {
      try {
        if (!existing.win.isDestroyed()) {
          existing.win.destroy();
        }
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

    const webContentsId = win.webContents.id;

    const queryParams = new URLSearchParams({
      projector: 'true',
      sourceId,
      appName,
      displayId,
    });

    // Store in params map so the window can also fetch its params directly via IPC
    windowProjectorParams.set(webContentsId, {
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
      try {
        windowProjectorParams.delete(webContentsId);
      } catch {}
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
        try {
          if (!entry.win.isDestroyed()) {
            entry.win.destroy();
          }
        } catch {}
        activeProjectors.delete(displayId);
      }
    } else {
      activeProjectors.forEach((entry) => {
        try {
          if (!entry.win.isDestroyed()) {
            entry.win.destroy();
          }
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
  displayId: string,
  sourceId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const displays = screen.getAllDisplays();
    const targetDisplay = displays.find((d) => d.id.toString() === displayId) || displays[0];
    if (!targetDisplay) {
      return { success: false, error: 'Tela de destino não encontrada' };
    }

    const { x, y, width, height } = targetDisplay.bounds;
    let hwndVal = 0;
    if (sourceId && sourceId.startsWith('window:')) {
      const parsed = parseInt(sourceId.split(':')[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        hwndVal = parsed;
      }
    }

    const escapedTitle = windowName.replace(/'/g, "''").replace(/[\[\]]/g, '').slice(0, 25);

    const psScript = `
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class Win32Mover {
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
  }
"@

$targetHwnd = [IntPtr]::Zero

${hwndVal > 0 ? `
try {
  $test = [IntPtr]${hwndVal}
  if ([Win32Mover]::IsWindow($test)) {
    $targetHwnd = $test
  }
} catch {}
` : ''}

if ($targetHwnd -eq [IntPtr]::Zero -and "${escapedTitle}") {
  $proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${escapedTitle}*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($proc) {
    $targetHwnd = $proc.MainWindowHandle
  }
}

if ($targetHwnd -ne [IntPtr]::Zero) {
  # SW_RESTORE (9) in case window is minimized
  [Win32Mover]::ShowWindow($targetHwnd, 9)
  # Move and resize to target screen coordinates (SWP_SHOWWINDOW = 0x0040)
  [Win32Mover]::SetWindowPos($targetHwnd, [IntPtr]::Zero, ${x}, ${y}, ${width}, ${height}, 0x0040)
  # SW_MAXIMIZE (3) so the app cleanly occupies the target display
  [Win32Mover]::ShowWindow($targetHwnd, 3)
  [Win32Mover]::SetForegroundWindow($targetHwnd)
  Write-Output "OK"
} else {
  Write-Output "NOT_FOUND"
}
`;

    const result = await runPowerShellScript(psScript);
    if (result.includes('OK')) {
      console.log(`[Projector] Window "${windowName}" moved successfully to screen ${displayId}`);
      return { success: true };
    } else {
      return { success: false, error: 'Janela do aplicativo não encontrada para movimentação' };
    }
  } catch (err: any) {
    console.error('[Projector] Move window error:', err);
    return { success: false, error: err?.message || 'Falha ao mover a janela' };
  }
}
