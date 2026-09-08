// ============================================================
// ScreenFlow — Screen Capture Module
// ============================================================

import { desktopCapturer, screen } from 'electron';
import type { AppWindowSource, DetailedScreenInfo, ScreenSource } from '../shared/types';
import { getActiveProjectors } from './projector';
import { getVirtualDisplayStatus, getSunshineConfig } from './gamestream-host';

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
    let virtualInstalled = false;
    try {
      const vdd = await getVirtualDisplayStatus();
      virtualInstalled = vdd.installed || vdd.active;
    } catch {}

    let moonlightConfig: any = null;
    try {
      moonlightConfig = await getSunshineConfig();
    } catch {}

    return displays.map((disp, idx) => {
      const isPrimary = disp.id === primaryDisplay.id;
      // Match with desktopCapturer source:
      // 1. By display_id matching disp.id
      // 2. By index (e.g. screen:0:0 for display 0)
      let matchedSource = sources.find((s) => s.display_id === disp.id.toString());
      if (!matchedSource) {
        matchedSource = sources[idx] || sources[0];
      }

      const sourceId = matchedSource?.id || `screen:${idx}:0`;
      const isVirtual = !isPrimary && (virtualInstalled || idx > 0);

      // Check if this screen is the target for Moonlight
      const isMoonlightTarget = Boolean(
        moonlightConfig &&
          (moonlightConfig.selectedSourceId === sourceId ||
            (isVirtual && moonlightConfig.captureDisplayIndex === idx) ||
            (!isPrimary && moonlightConfig.captureDisplayIndex > 0))
      );

      const projected = activeProjectors[disp.id.toString()] || null;

      const scale = disp.scaleFactor || 1;
      const resW = Math.round((disp.bounds.width || disp.size.width) * scale);
      const resH = Math.round((disp.bounds.height || disp.size.height) * scale);

      const name = isPrimary
        ? `Tela 1 — Monitor Principal (${resW}×${resH})`
        : isVirtual
        ? `Tela ${idx + 1} — Monitor Virtual Moonlight (${resW}×${resH})`
        : `Tela ${idx + 1} — Monitor Secundário (${resW}×${resH})`;

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
 */
export async function getAppWindows(): Promise<AppWindowSource[]> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: true,
    });

    return sources
      .filter((s) => {
        // Exclude SpaceViewer's own windows to avoid infinite hall of mirrors
        const lower = s.name.toLowerCase();
        if (!lower || lower.trim() === '') return false;
        if (lower.includes('spaceviewer') || lower.includes('space viewer')) return false;
        if (lower === 'program manager' || lower === 'task switching') return false;
        return true;
      })
      .map((s) => ({
        id: s.id,
        name: s.name,
        appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
        thumbnail: s.thumbnail.toDataURL(),
      }));
  } catch (err) {
    console.error('[Capture] Error getting app windows:', err);
    return [];
  }
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

