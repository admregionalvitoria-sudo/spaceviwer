// SpaceViewer v2.2.9
// ============================================================
// ScreenFlow — Screen Capture Module
// ============================================================

import { desktopCapturer, screen } from 'electron';
import { exec } from 'child_process';
import type { AppWindowSource, DetailedScreenInfo, ScreenSource } from '../shared/types';
import { getActiveProjectors } from './projector';
import { getHostDisplays, getHostSettings } from './gamestream-host';
import { getWindowsDisplayInventory, matchWindowsDisplay } from './windows-displays';

/**
 * Lists all available screens and windows for capture.
 */
export async function getAvailableScreens(): Promise<ScreenSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });

  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    displayId: s.display_id,
  }));
}

/**
 * Gets rich detailed information for all connected screens with high-definition live previews.
 */
export async function getScreensDetailed(): Promise<DetailedScreenInfo[]> {
  try {
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 960, height: 540 },
    });

    const activeProjectors = getActiveProjectors();
    const [inventory, hostDisplays, settings] = await Promise.all([getWindowsDisplayInventory(), getHostDisplays(), getHostSettings()]);

    let seenVirtual = false;
    const filteredDisplays = displays.filter((disp) => {
      const isPrimary = disp.id === primaryDisplay.id;
      if (isPrimary) return true;
      const native = matchWindowsDisplay(disp, inventory.displays);
      if (native?.isVirtual) {
        if (seenVirtual) return false;
        seenVirtual = true;
      }
      return true;
    });

    return filteredDisplays.map((disp, idx) => {
      const isPrimary = disp.id === primaryDisplay.id;
      const matchedSource = sources.find((s) => s.display_id === String(disp.id));
      const sourceId = matchedSource?.id || '';
      const native = matchWindowsDisplay(disp, inventory.displays);
      const isVirtual = native?.isVirtual ?? false;
      const isMoonlightTarget = Boolean(native && hostDisplays.some((d) => d.index === settings.display && d.deviceName.toLowerCase() === native.deviceName.toLowerCase()));

      const projected = activeProjectors[disp.id.toString()] || null;

      const scale = disp.scaleFactor || 1;
      const resW = Math.round((disp.bounds.width || disp.size.width) * scale);
      const resH = Math.round((disp.bounds.height || disp.size.height) * scale);

      const name = isPrimary
        ? `Tela 1 — Monitor Principal (${resW}×${resH})`
        : isVirtual
        ? `Tela 2 — Monitor Virtual Moonlight (${resW}×${resH})`
        : `Tela ${idx + 1} — Monitor Físico (${resW}×${resH})`;

      return {
        id: sourceId,
        displayId: disp.id.toString(),
        name,
        bounds: disp.bounds,
        size: { width: resW, height: resH },
        scaleFactor: scale,
        isPrimary,
        isVirtual,
        isMoonlightTarget,
        thumbnail: matchedSource ? matchedSource.thumbnail.toDataURL() : '',
        projectedApp: projected ? { sourceId: projected.sourceId, appName: projected.appName } : null,
      };
    });
  } catch (err) {
    console.error('[Capture] Error getting detailed screens:', err);
    return [];
  }
}

/**
 * Lists all running application windows on the PC for casting to displays.
 * Includes visible and minimized windows, with fallback to active process windows.
 */
export async function getAppWindows(): Promise<AppWindowSource[]> {
  const result: AppWindowSource[] = [];
  const seenNames = new Set<string>();

  try {
    let sources: Electron.DesktopCapturerSource[] = [];
    try {
      sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });
    } catch {
      sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false,
      });
    }

    for (const s of sources) {
      const lower = s.name.toLowerCase().trim();
      if (!lower) continue;
      if (lower.includes('spaceviewer') || lower.includes('space viewer')) continue;
      if (lower === 'program manager' || lower === 'task switching' || lower === 'settings') continue;

      seenNames.add(lower);
      result.push({
        id: s.id,
        name: s.name,
        appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
        thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : '',
      });
    }
  } catch (err) {
    console.warn('[Capture] desktopCapturer window search notice:', err);
  }

  // Complement with open desktop processes (detects minimized windows, browsers, office, etc.)
  try {
    if (process.platform === 'win32') {
      const psScript = `
        Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim() -ne '' } | ForEach-Object {
          $_.MainWindowHandle.ToString() + '|||' + $_.MainWindowTitle.Trim() + '|||' + $_.ProcessName
        }
      `;
      const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
      const stdout = await new Promise<string>((resolve) => {
        exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${b64}`, (err, out) => {
          resolve(out || '');
        });
      });

      const lines = stdout.split(/\r?\n/);
      for (const line of lines) {
        const parts = line.split('|||');
        if (parts.length >= 2) {
          const hwnd = parts[0].trim();
          const title = parts[1].trim();
          const lower = title.toLowerCase();

          if (!title || lower.includes('spaceviewer') || lower.includes('program manager') || lower.includes('settings')) continue;
          if (seenNames.has(lower)) continue;

          seenNames.add(lower);
          result.push({
            id: `window:${hwnd}`,
            name: title,
            appIcon: null,
            thumbnail: '',
          });
        }
      }
    }
  } catch (err) {
    console.warn('[Capture] Fallback process window enumeration notice:', err);
  }

  return result;
}

/**
 * Gets information about all connected displays.
 */
export function getDisplaysInfo() {
  const displays = screen.getAllDisplays();
  return displays.map((d) => ({
    id: d.id.toString(),
    label: d.label || `Display ${d.id}`,
    bounds: d.bounds,
    size: d.size,
    scaleFactor: d.scaleFactor,
    isPrimary: d.id === screen.getPrimaryDisplay().id,
  }));
}

