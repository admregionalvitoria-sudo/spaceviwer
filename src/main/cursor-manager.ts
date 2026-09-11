import { runPowerShell } from './windows-powershell';

let lastApplied = 0;

/**
 * Ensures Windows DWM software cursor composition is active so that the mouse cursor
 * is drawn directly into the virtual display framebuffer and captured by DXGI Desktop Duplication.
 *
 * Calls SystemParametersInfo(SPI_SETMOUSETRAILS, 2, 0, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE)
 * and updates HKCU:\Control Panel\Mouse\MouseTrails = 2.
 */
export async function ensureVirtualDisplayCursorVisible(): Promise<{ success: boolean; error?: string }> {
  if (process.platform !== 'win32') {
    return { success: true };
  }

  // Throttle consecutive calls within 1 second to avoid unnecessary shell spawns
  const now = Date.now();
  if (now - lastApplied < 1000) {
    return { success: true };
  }
  lastApplied = now;

  try {
    const script = `
$def = @"
using System;
using System.Runtime.InteropServices;
public class WinUserCursor {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
}
"@
Add-Type -TypeDefinition $def -ErrorAction SilentlyContinue
[WinUserCursor]::SystemParametersInfo(0x005D, 2, [IntPtr]::Zero, 3) | Out-Null
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name MouseTrails -Value 2 -ErrorAction SilentlyContinue
`;
    await runPowerShell(script, false);
    console.log('[CursorManager] Software cursor enforced on virtual display (MouseTrails: 2)');
    return { success: true };
  } catch (error) {
    const message = (error as Error).message;
    console.warn('[CursorManager] Failed to set software cursor trails:', message);
    return { success: false, error: message };
  }
}
