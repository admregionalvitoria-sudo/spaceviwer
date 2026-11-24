import { app, screen } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { runPowerShell, psLiteral } from './windows-powershell';
import type { VirtualDisplayState } from '../shared/types';
import { MAX_VIRTUAL_DISPLAYS } from '../shared/constants';

export interface WindowsDisplay {
  deviceName: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  refreshRate: number;
  /** HMONITOR from EnumDisplayMonitors (usable by FFmpeg gfxcapture). */
  hmonitor?: number;
  primary: boolean;
  isVirtual: boolean;
}

export interface VirtualOutput {
  deviceName: string;
  attached: boolean;
  width: number;
  height: number;
  refreshRate: number;
}

export interface DisplayInventory extends VirtualDisplayState {
  configuredCount: number;
  displays: WindowsDisplay[];
  virtualOutputs: VirtualOutput[];
}

const EMPTY_INVENTORY: DisplayInventory = {
  installed: false,
  active: false,
  enabled: false,
  count: 0,
  configuredCount: 0,
  outputs: 0,
  displays: [],
  virtualOutputs: [],
};

let cached: { time: number; value: DisplayInventory } | undefined;
let pending: Promise<DisplayInventory> | undefined;
let mutationQueue: Promise<unknown> = Promise.resolve();

export function resourceFile(file: string): string {
  const candidates = [
    ...(app.isPackaged ? [path.join(process.resourcesPath, 'spaceviwerstream', file)] : []),
    path.join(app.getAppPath(), 'resources', 'spaceviwerstream', file),
    path.join(process.cwd(), 'resources', 'spaceviwerstream', file),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

const managerPath = () => resourceFile('display-manager.ps1');
export const displayCtlPath = () => resourceFile('SpaceviwerStreamDisplayCtl.exe');

export function invalidateDisplayInventory(): void { cached = undefined; }

export async function getWindowsDisplayInventory(): Promise<DisplayInventory> {
  if (process.platform !== 'win32') return EMPTY_INVENTORY;
  if (cached && Date.now() - cached.time < 2000) return cached.value;
  if (pending) return pending;
  pending = runPowerShell(`& ${psLiteral(managerPath())} -Action query\nexit $LASTEXITCODE`)
    .then((output) => {
      const parsed = JSON.parse(output) as DisplayInventory;
      // ConvertTo-Json collapses single-element arrays in some PowerShell versions.
      const rawDisplays = parsed.displays;
      const displays: WindowsDisplay[] = Array.isArray(rawDisplays)
        ? rawDisplays
        : rawDisplays
        ? [rawDisplays as unknown as WindowsDisplay]
        : [];
      const rawOutputs = (parsed as any).virtualOutputs;
      const virtualOutputs: VirtualOutput[] = Array.isArray(rawOutputs)
        ? rawOutputs
        : rawOutputs
        ? [rawOutputs as VirtualOutput]
        : [];
      const value: DisplayInventory = {
        ...parsed,
        displays,
        virtualOutputs,
        outputs: virtualOutputs.length,
      };
      cached = { time: Date.now(), value };
      return value;
    }).finally(() => { pending = undefined; });
  return pending;
}

export function matchWindowsDisplay(display: Electron.Display, inventory: WindowsDisplay[]): WindowsDisplay | undefined {
  const bounds = screen.dipToScreenRect(null, display.bounds);
  return inventory.find((d) => d.x === bounds.x && d.y === bounds.y && d.width === bounds.width && d.height === bounds.height)
    // Fall back to the top-left corner when DPI rounding makes sizes differ by a pixel.
    ?? inventory.find((d) => Math.abs(d.x - bounds.x) <= 2 && Math.abs(d.y - bounds.y) <= 2);
}

type ManagerAction = 'set-count' | 'enable' | 'disable' | 'install' | 'remove';

/** Installs / enables / disables the MttVDD virtual display driver and sets how many virtual monitors it exposes. */
export function changeVirtualDisplays(action: ManagerAction, count = 1): Promise<{ success: boolean; error?: string }> {
  const target = Math.min(MAX_VIRTUAL_DISPLAYS, Math.max(1, Math.round(count)));
  const operation = mutationQueue.then(async () => {
    try {
      // Do not retain a pre-mutation query result after changing the device.
      if (pending) await pending.catch(() => {});
      await runPowerShell(`& ${psLiteral(managerPath())} -Action ${action} -Count ${target}\nexit $LASTEXITCODE`, true);
      invalidateDisplayInventory();
      let state = await getWindowsDisplayInventory();
      if ((action === 'disable' && state.enabled) || (action === 'remove' && state.installed) ||
          (['enable', 'install', 'set-count'].includes(action) && !state.enabled)) {
        throw new Error('O Windows ainda não confirmou a instalação do driver de tela estendida.');
      }
      if (['set-count', 'enable', 'install'].includes(action)) {
        for (let attempt = 0; attempt < 8 && (!state.enabled || state.virtualOutputs.length < 1); attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          invalidateDisplayInventory();
          state = await getWindowsDisplayInventory();
        }
        if (!state.enabled || state.virtualOutputs.length < 1) {
          throw new Error('O driver está habilitado, mas o Windows não disponibilizou nenhuma saída de tela virtual. Se estiver usando Área de Trabalho Remota, teste na sessão local.');
        }
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: `Falha no driver de tela estendida: ${(error as Error).message}` };
    } finally { invalidateDisplayInventory(); }
  });
  mutationQueue = operation.catch(() => {});
  return operation;
}

/** Attaches a virtual output with ChangeDisplaySettingsEx (no elevation needed). */
export function attachVirtualOutput(
  deviceName: string,
  x: number,
  y: number,
  width: number,
  height: number,
  hz: number
): Promise<{ success: boolean; error?: string }> {
  const operation = mutationQueue.then(async () => {
    try {
      await runPowerShell(
        `& ${psLiteral(managerPath())} -Action attach -Device ${psLiteral(deviceName)} -X ${Math.round(x)} -Y ${Math.round(y)} -Width ${Math.round(width)} -Height ${Math.round(height)} -Hz ${Math.round(hz)}\nexit $LASTEXITCODE`
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    } finally {
      invalidateDisplayInventory();
    }
  });
  mutationQueue = operation.catch(() => {});
  return operation;
}

/** Detaches a single virtual output (no elevation needed). */
export function detachVirtualOutput(deviceName: string): Promise<{ success: boolean; error?: string }> {
  const operation = mutationQueue.then(async () => {
    try {
      await runPowerShell(
        `& ${psLiteral(managerPath())} -Action detach -Device ${psLiteral(deviceName)}\nexit $LASTEXITCODE`
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    } finally {
      invalidateDisplayInventory();
    }
  });
  mutationQueue = operation.catch(() => {});
  return operation;
}

/** Detaches all virtual outputs (no elevation needed). */
export function detachAllVirtualOutputs(): Promise<{ success: boolean; error?: string }> {
  const operation = mutationQueue.then(async () => {
    try {
      await runPowerShell(
        `& ${psLiteral(managerPath())} -Action detach-all\nexit $LASTEXITCODE`
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    } finally {
      invalidateDisplayInventory();
    }
  });
  mutationQueue = operation.catch(() => {});
  return operation;
}

/** Moves a non-primary monitor or makes a monitor primary (no elevation needed). */
export function changeDisplayLayout(action: 'set-position' | 'set-primary', deviceName: string, x = 0, y = 0): Promise<{ success: boolean; error?: string }> {
  const operation = mutationQueue.then(async () => {
    try {
      await runPowerShell(`& ${psLiteral(managerPath())} -Action ${action} -Device ${psLiteral(deviceName)} -X ${Math.round(x)} -Y ${Math.round(y)}\nexit $LASTEXITCODE`);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    } finally { invalidateDisplayInventory(); }
  });
  mutationQueue = operation.catch(() => {});
  return operation;
}
