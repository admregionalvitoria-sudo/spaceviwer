import { app, screen } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { runPowerShell, psLiteral } from './windows-powershell';
import type { VirtualDisplayState } from '../shared/types';

export interface WindowsDisplay {
  deviceName: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
  isVirtual: boolean;
}

interface DisplayInventory extends VirtualDisplayState {
  configuredCount: number;
  displays: WindowsDisplay[];
}

let cached: { time: number; value: DisplayInventory } | undefined;
let pending: Promise<DisplayInventory> | undefined;
let mutationQueue: Promise<unknown> = Promise.resolve();

function managerPath(): string {
  const candidates = [
    ...(app.isPackaged ? [path.join(process.resourcesPath, 'spaceviwerstream', 'display-manager.ps1')] : []),
    path.join(app.getAppPath(), 'resources', 'spaceviwerstream', 'display-manager.ps1'),
    path.join(process.cwd(), 'resources', 'spaceviwerstream', 'display-manager.ps1'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

export function invalidateDisplayInventory(): void { cached = undefined; }

export async function getWindowsDisplayInventory(): Promise<DisplayInventory> {
  if (process.platform !== 'win32') return { installed: false, active: false, enabled: false, count: 0, configuredCount: 1, displays: [] };
  if (cached && Date.now() - cached.time < 2000) return cached.value;
  if (pending) return pending;
  pending = runPowerShell(`& ${psLiteral(managerPath())} -Action query\nexit $LASTEXITCODE`)
    .then((output) => {
      const value: DisplayInventory = JSON.parse(output);
      cached = { time: Date.now(), value };
      return value;
    }).finally(() => { pending = undefined; });
  return pending;
}

export function matchWindowsDisplay(display: Electron.Display, inventory: WindowsDisplay[]): WindowsDisplay | undefined {
  const bounds = screen.dipToScreenRect(null, display.bounds);
  return inventory.find((d) => d.x === bounds.x && d.y === bounds.y && d.width === bounds.width && d.height === bounds.height);
}

export async function changeVirtualDisplays(action: 'set-count' | 'enable' | 'disable' | 'install' | 'remove', count = 1): Promise<{ success: boolean; error?: string }> {
  if (!Number.isInteger(count) || count < 1 || count > 4) return { success: false, error: 'Escolha de 1 a 4 telas virtuais.' };
  const operation = mutationQueue.then(async () => {
    try {
      // Do not retain a pre-mutation query result after changing the device.
      if (pending) await pending.catch(() => {});
      await runPowerShell(`& ${psLiteral(managerPath())} -Action ${action} -Count ${count}\nexit $LASTEXITCODE`, true);
      invalidateDisplayInventory();
      let state = await getWindowsDisplayInventory();
      if ((action === 'disable' && state.enabled) || (action === 'remove' && state.installed) ||
          (['enable', 'install', 'set-count'].includes(action) && !state.enabled)) {
        throw new Error('O Windows ainda não confirmou a alteração das telas virtuais.');
      }
      if (action === 'set-count') {
        for (let attempt = 0; attempt < 4 && state.displays.filter((d) => d.isVirtual).length !== count; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          invalidateDisplayInventory();
          state = await getWindowsDisplayInventory();
        }
        if (state.displays.filter((d) => d.isVirtual).length !== count) {
          throw new Error('O driver recebeu a configuração, mas o Windows ainda não disponibilizou a quantidade solicitada de telas.');
        }
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: `Falha ao alterar as telas virtuais: ${(error as Error).message}` };
    } finally { invalidateDisplayInventory(); }
  });
  mutationQueue = operation.catch(() => {});
  return operation;
}
