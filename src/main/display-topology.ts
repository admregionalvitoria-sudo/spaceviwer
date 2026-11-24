// ============================================================
// SpaceViewer — PC display topology (monitors, virtual displays, extend/duplicate)
// Uses the MttVDD virtual display driver through display-manager.ps1 and
// SpaceviwerStreamDisplayCtl.exe. See docs/ARQUITETURA-TELA-ESTENDIDA.md §5.1.
// ============================================================

import { desktopCapturer, screen } from 'electron';
import { execFile } from 'child_process';
import * as fs from 'fs';
import {
  attachVirtualOutput,
  changeDisplayLayout,
  changeVirtualDisplays,
  detachAllVirtualOutputs,
  detachVirtualOutput,
  displayCtlPath,
  getWindowsDisplayInventory,
  invalidateDisplayInventory,
  matchWindowsDisplay,
  resourceFile,
} from './windows-displays';
import { optionalWithin } from '../shared/async';
import type { DisplayActionResult, PcDisplay, VirtualDriverState } from '../shared/types';

export { attachVirtualOutput, detachVirtualOutput, detachAllVirtualOutputs };

/** Virtual monitor modes offered by vdd_settings.xml (fallback when an exact size is refused). */
export const VIRTUAL_MODES: Array<[number, number]> = [
  [1280, 720], [1280, 800], [1366, 768], [1600, 900], [1920, 1080], [1920, 1200], [2000, 1200], [2048, 1536],
  [2160, 1080], [2340, 1080], [2400, 1080], [2560, 1440], [2560, 1600], [2732, 2048], [2800, 1752], [2880, 1800],
  [3200, 2000], [3840, 2160], [720, 1280], [800, 1280], [1080, 1920], [1200, 1920], [1080, 2400], [1600, 2560],
];

/** Closest supported virtual mode: same orientation, nearest aspect ratio, then nearest area. */
export function closestVirtualMode(width: number, height: number): [number, number] {
  const portrait = height > width;
  const aspect = width / height;
  return VIRTUAL_MODES
    .filter(([w, h]) => (h > w) === portrait)
    .sort((a, b) => {
      const da = Math.abs(a[0] / a[1] - aspect), db = Math.abs(b[0] / b[1] - aspect);
      if (Math.abs(da - db) > 0.02) return da - db;
      return Math.abs(a[0] * a[1] - width * height) - Math.abs(b[0] * b[1] - width * height);
    })[0] ?? [1920, 1080];
}

let listPending: Promise<PcDisplay[]> | null = null;

function runDisplayCtl(args: string[]): Promise<DisplayActionResult> {
  return new Promise((resolve) => {
    const exe = displayCtlPath();
    if (!fs.existsSync(exe)) {
      resolve({ success: false, error: 'SpaceviwerStreamDisplayCtl.exe não encontrado. Reinstale o SpaceViewer.' });
      return;
    }
    execFile(exe, args, { windowsHide: true, timeout: 20000 }, (error, _stdout, stderr) => {
      invalidateDisplayInventory();
      if (error) resolve({ success: false, error: (stderr || error.message).toString().trim() || `Falha (${args[0]}).` });
      else resolve({ success: true });
    });
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lists every monitor Windows exposes, with live thumbnails and the receivers bound to it. */
export function listPcDisplays(assigned: Record<string, string[]> = {}, thumbnails = true): Promise<PcDisplay[]> {
  if (!listPending) {
    listPending = loadPcDisplays(thumbnails).finally(() => { listPending = null; });
  }
  return listPending.then((list) => list.map((d) => ({ ...d, assignedReceiverIds: assigned[d.id] || [] })));
}

async function loadPcDisplays(thumbnails: boolean): Promise<PcDisplay[]> {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const [sources, inventory] = await Promise.all([
    optionalWithin(desktopCapturer.getSources({ types: ['screen'], thumbnailSize: thumbnails ? { width: 480, height: 270 } : { width: 1, height: 1 } }), []),
    optionalWithin(getWindowsDisplayInventory(), { installed: false, enabled: false, active: false, count: 0, configuredCount: 0, outputs: 0, displays: [], virtualOutputs: [] }),
  ]);

  // Some sessions (e.g. Remote Desktop) report screen sources without display_id: match those by order.
  const unmatched = sources.filter((s) => !displays.some((d) => s.display_id === String(d.id)));
  let virtualIndex = 0;
  return displays
    .slice()
    .sort((a, b) => (a.id === primaryId ? -1 : b.id === primaryId ? 1 : a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y))
    .map((display, index) => {
      const native = matchWindowsDisplay(display, inventory.displays);
      const source = sources.find((s) => s.display_id === String(display.id))
        ?? (unmatched.length === displays.length ? unmatched[displays.indexOf(display)] : undefined);
      const scale = display.scaleFactor || 1;
      const width = native?.width ?? Math.round(display.bounds.width * scale);
      const height = native?.height ?? Math.round(display.bounds.height * scale);
      const isVirtual = Boolean(native?.isVirtual);
      const primary = display.id === primaryId;
      const label = primary
        ? 'Monitor principal'
        : isVirtual
        ? `Tela estendida ${++virtualIndex}`
        : native?.label && !/generic|genérico/i.test(native.label) ? native.label : `Monitor ${index + 1}`;
      return {
        id: String(display.id),
        deviceName: native?.deviceName ?? '',
        label,
        bounds: { ...display.bounds },
        width,
        height,
        refreshRate: native?.refreshRate || Math.round(display.displayFrequency || 60),
        scaleFactor: scale,
        primary,
        virtual: isVirtual,
        sourceId: source?.id ?? '',
        thumbnail: thumbnails && source ? source.thumbnail.toDataURL() : '',
        assignedReceiverIds: [],
      } satisfies PcDisplay;
    });
}

export async function getVirtualDriverState(): Promise<VirtualDriverState> {
  const { installed, enabled, count, virtualOutputs } = await getWindowsDisplayInventory();
  const inventory = await getWindowsDisplayInventory();
  return { installed, enabled, count, outputs: virtualOutputs?.length ?? 0, remoteSession: isRemoteSession(inventory.displays) };
}

/**
 * Remote Desktop: SESSIONNAME is "RDP-Tcp#n" (not always inherited), and every desktop monitor
 * belongs to the "Microsoft Remote Display Adapter".
 */
export function isRemoteSession(displays: Array<{ label: string }> = []): boolean {
  if (process.platform !== 'win32') return false;
  if (/^rdp-/i.test(process.env.SESSIONNAME || '')) return true;
  return displays.length > 0 && displays.every((d) => /remote display/i.test(d.label || ''));
}

const REMOTE_SESSION_ERROR = 'Você está usando o PC pela Área de Trabalho Remota: o Windows não mostra telas estendidas nessa sessão (o spacedesk também não funciona assim). Use o PC diretamente para Estender, ou escolha Duplicar.';

export async function installVirtualDriver(): Promise<DisplayActionResult> {
  const result = await changeVirtualDisplays('install', 4);
  return result;
}

export async function attachVirtualDisplay(
  width: number,
  height: number,
  hz: number,
  busyDeviceNames: string[] = []
): Promise<{ success: boolean; error?: string; display?: PcDisplay }> {
  const inventory = await getWindowsDisplayInventory();
  if (isRemoteSession(inventory.displays)) return { success: false, error: REMOTE_SESSION_ERROR };
  if (!inventory.installed || !inventory.enabled) {
    return {
      success: false,
      error: 'O driver de tela estendida não está instalado. Clique em "Instalar driver de tela estendida" (pede administrador uma única vez) ou reinstale o SpaceViewer.',
    };
  }

  if ((inventory.virtualOutputs || []).length === 0) {
    // Driver from an older version (or not yet re-enumerated): it exposes no detached outputs to attach.
    return {
      success: false,
      error: 'O driver de tela estendida precisa ser atualizado. Clique em "Instalar driver de tela estendida" em Telas (pede administrador uma única vez).',
    };
  }

  const available = (inventory.virtualOutputs || []).filter(
    (vo) => !busyDeviceNames.includes(vo.deviceName)
  );
  if (available.length === 0) {
    return { success: false, error: 'Limite de 4 telas estendidas atingido.' };
  }

  const target = available.find((vo) => !vo.attached) ?? available[0];

  let maxX = 0;
  for (const d of inventory.displays) {
    if (d.deviceName !== target.deviceName) {
      maxX = Math.max(maxX, d.x + d.width);
    }
  }
  const x = maxX;
  const y = 0;

  let attachResult = await attachVirtualOutput(target.deviceName, x, y, width, height, hz);
  if (!attachResult.success) {
    const [cw, ch] = closestVirtualMode(width, height);
    attachResult = await attachVirtualOutput(target.deviceName, x, y, cw, ch, 60);
    if (!attachResult.success) {
      return { success: false, error: attachResult.error };
    }
  }

  const displays = await waitForElectronDisplays((list) =>
    list.some((d) => d.deviceName === target.deviceName)
  );
  const display = displays.find((d) => d.deviceName === target.deviceName);
  if (!display) {
    return { success: false, error: 'O Windows não disponibilizou a tela estendida a tempo.' };
  }
  return { success: true, display };
}

export async function detachVirtualDisplay(deviceName: string): Promise<DisplayActionResult> {
  if (!deviceName) return { success: true };
  return detachVirtualOutput(deviceName);
}

export async function setDisplayMode(deviceName: string, width: number, height: number, refreshRate: number): Promise<DisplayActionResult> {
  if (!deviceName) return { success: false, error: 'Tela sem identificação do Windows.' };
  const w = Math.round(width), h = Math.round(height), hz = Math.round(refreshRate);
  if (w < 320 || h < 240 || hz <= 0) return { success: false, error: 'Resolução inválida.' };
  const result = await runDisplayCtl(['mode', deviceName, String(w), String(h), String(hz)]);
  if (!result.success) {
    return { success: false, error: `O Windows não aceitou ${w}×${h} @ ${hz} Hz nesta tela. ${result.error ?? ''}`.trim() };
  }
  await wait(500);
  return result;
}

export function setDisplayPosition(deviceName: string, x: number, y: number): Promise<DisplayActionResult> {
  return changeDisplayLayout('set-position', deviceName, x, y);
}

export function setPrimaryDisplay(deviceName: string): Promise<DisplayActionResult> {
  return changeDisplayLayout('set-primary', deviceName);
}

/** Polls Electron's display list until `predicate` is satisfied (Windows applies topology asynchronously). */
export async function waitForElectronDisplays(predicate: (list: PcDisplay[]) => boolean, timeoutMs = 8000): Promise<PcDisplay[]> {
  const started = Date.now();
  let list = await listPcDisplays({}, false);
  while (!predicate(list) && Date.now() - started < timeoutMs) {
    await wait(400);
    invalidateDisplayInventory();
    list = await listPcDisplays({}, false);
  }
  return list;
}

export const virtualDriverAvailable = () => fs.existsSync(resourceFile('driver/virtual-display/MttVDD.inf'));
