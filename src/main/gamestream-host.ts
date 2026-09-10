// ============================================================
// SpaceViewer — Native GameStream Host Manager (SenaiStream)
// Replaces Sunshine with native C++20 GameStream host and
// manages the virtual display driver for extended desktop streaming.
// ============================================================

import { spawn, exec, execFile, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import { app, screen } from 'electron';
import type {
  GameStreamStatus,
  SunshineStatus,
  DisplayTopologyMode,
  HostDisplayInfo,
  HostSettings,
  VirtualDisplayStatus,
  MoonlightClient,
  SunshineStreamStats,
  SunshineConfig,
  ScreenSource,
} from '../shared/types';

const HOST_PORT = 47990;
let hostProcess: ChildProcess | null = null;
let _pairingWatcherTimer: NodeJS.Timeout | null = null;
let _wasPairingWaiting = false;
let _streamingStartedAt: number | null = null;
let _currentDisplayMode: DisplayTopologyMode = 'extended';

// ============================================================
// Path Resolvers
// ============================================================

export function getSenaiStreamExePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'senaistream', 'SenaiStream.exe');
  }
  const devPath = path.join(app.getAppPath(), 'resources', 'senaistream', 'SenaiStream.exe');
  if (fs.existsSync(devPath)) return devPath;
  const cwdPath = path.join(process.cwd(), 'resources', 'senaistream', 'SenaiStream.exe');
  if (fs.existsSync(cwdPath)) return cwdPath;
  return devPath;
}

export function getDisplayCtlExePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'senaistream', 'SenaiStreamDisplayCtl.exe');
  }
  const devPath = path.join(app.getAppPath(), 'resources', 'senaistream', 'SenaiStreamDisplayCtl.exe');
  if (fs.existsSync(devPath)) return devPath;
  const cwdPath = path.join(process.cwd(), 'resources', 'senaistream', 'SenaiStreamDisplayCtl.exe');
  if (fs.existsSync(cwdPath)) return cwdPath;
  return devPath;
}

export function getVirtualDisplayInfPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'senaistream', 'driver', 'virtual-display', 'MttVDD.inf');
  }
  const devPath = path.join(app.getAppPath(), 'resources', 'senaistream', 'driver', 'virtual-display', 'MttVDD.inf');
  if (fs.existsSync(devPath)) return devPath;
  const cwdPath = path.join(process.cwd(), 'resources', 'senaistream', 'driver', 'virtual-display', 'MttVDD.inf');
  if (fs.existsSync(cwdPath)) return cwdPath;
  return devPath;
}

function getClientsDirectory(): string {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'SenaiStream', 'clients');
}

// ============================================================
// Internal HTTP Helpers for Loopback API (127.0.0.1:47990)
// ============================================================

function loopbackRequest(
  method: 'GET' | 'POST',
  reqPath: string,
  bodyParams?: Record<string, string | number | boolean>
): Promise<{ status: number; data: any; raw: string }> {
  return new Promise((resolve) => {
    const postData = bodyParams
      ? new URLSearchParams(
          Object.entries(bodyParams).map(([k, v]) => [k, String(v)])
        ).toString()
      : undefined;

    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: HOST_PORT,
      path: reqPath,
      method,
      timeout: 3000,
      headers: postData
        ? {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
          }
        : undefined,
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, data: JSON.parse(raw), raw });
        } catch {
          resolve({ status: res.statusCode || 0, data: null, raw });
        }
      });
    });

    req.on('error', () => {
      resolve({ status: 0, data: null, raw: '' });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, data: null, raw: 'Timeout' });
    });

    if (postData) req.write(postData);
    req.end();
  });
}

// ============================================================
// Process Lifecycle Management (SenaiStream.exe --host)
// ============================================================

export async function checkHostStatus(): Promise<SunshineStatus> {
  // Check loopback API directly first
  try {
    const res = await loopbackRequest('GET', '/api/status');
    if (res.status === 200) {
      return 'running';
    }
  } catch {}

  // Check running process list
  return new Promise((resolve) => {
    exec('tasklist /fi "imagename eq SenaiStream.exe"', (err, stdout) => {
      if (!err && stdout.toLowerCase().includes('senaistream.exe')) {
        resolve('running');
      } else {
        resolve('stopped');
      }
    });
  });
}

function ensureSunshineConfig(exePath: string): string {
  const hostname = os.hostname();
  const sunshineName = `spacedesk - ${hostname}`;
  const confContent = [
    `sunshine_name = ${sunshineName}`,
    'min_log_level = info',
    'origin_web_ui_allowed = lan',
    'port = 47989',
    '',
  ].join('\n');

  const primaryConfDir = path.join(path.dirname(exePath), 'config');
  const primaryConfPath = path.join(primaryConfDir, 'sunshine.conf');

  const confDirs = [
    primaryConfDir,
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'SenaiStream', 'config'),
    path.join(os.homedir(), '.config', 'sunshine'),
    path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Sunshine'),
  ];

  for (const dir of confDirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const targetPath = path.join(dir, 'sunshine.conf');
      fs.writeFileSync(targetPath, confContent, 'utf-8');
      console.log(`[GameStreamHost] Synced sunshine.conf (spacedesk - ${hostname}) to: ${targetPath}`);
    } catch (err) {
      console.warn(`[GameStreamHost] Warning writing sunshine.conf to ${dir}:`, err);
    }
  }

  return primaryConfPath;
}

export async function startHost(): Promise<boolean> {
  const exePath = getSenaiStreamExePath();
  console.log(`[GameStreamHost] Starting native host at: ${exePath}`);

  if (!fs.existsSync(exePath)) {
    console.error(`[GameStreamHost] Executable not found at: ${exePath}`);
    return false;
  }

  // Ensure virtual display settings (4 screens) are synchronized
  ensureVirtualDisplaySettingsSync();

  try {
    // 1. Terminate any legacy Sunshine processes or stale SenaiStream processes
    await new Promise<void>((resolve) => {
      exec('taskkill /f /im sunshine.exe /im SenaiStream.exe', () => resolve());
    });

    // 2. Short pause for ports to be released
    await new Promise<void>((resolve) => setTimeout(resolve, 800));

    // Ensure sunshine config sets host name to spacedesk - [hostname]
    const confPath = ensureSunshineConfig(exePath);

    // 3. Spawn SenaiStream with config file and --host flag
    hostProcess = spawn(exePath, [confPath, '--host'], {
      cwd: path.dirname(exePath),
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    hostProcess.stdout?.on('data', (data) => {
      console.log(`[SenaiStream] ${data.toString().trim()}`);
    });

    hostProcess.stderr?.on('data', (data) => {
      console.warn(`[SenaiStream] ${data.toString().trim()}`);
    });

    hostProcess.on('error', (err) => {
      console.error('[GameStreamHost] Process error:', err);
    });

    hostProcess.on('exit', (code) => {
      console.log(`[GameStreamHost] Process exited with code ${code}`);
      hostProcess = null;
    });

    // 4. Configure initial topology based on current user preference
    const ctlPath = getDisplayCtlExePath();
    if (fs.existsSync(ctlPath)) {
      const initialMode = _currentDisplayMode === 'extended' ? 'extend' : 'duplicate';
      execFile(ctlPath, [initialMode], () => {});
    }

    // 5. Wait for the host HTTP loopback server to be ready
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      const res = await loopbackRequest('GET', '/api/status');
      if (res.status === 200) {
        console.log('[GameStreamHost] Host is up and responsive on port 47990');
        // Synchronize display capture settings with running host
        await setHostSettings({
          virtualDisplay: _currentDisplayMode === 'extended',
          display: 0,
        });

        // Ensure virtual display driver is active; trigger auto-installer if missing
        getVirtualDisplayStatus().then((st) => {
          if (!st.installed) {
            console.log('[GameStreamHost] Virtual display driver not active, auto-installing...');
            installVirtualDisplayDriver().catch((e) => {
              console.warn('[GameStreamHost] Auto-install driver error:', e);
            });
          }
        });

        return true;
      }
    }

    return true;
  } catch (err) {
    console.error('[GameStreamHost] Failed to start:', err);
    return false;
  }
}

export async function stopHost(): Promise<void> {
  console.log('[GameStreamHost] Stopping host process...');
  if (hostProcess) {
    try {
      hostProcess.kill();
    } catch (err) {
      console.error('[GameStreamHost] Error killing process:', err);
    }
    hostProcess = null;
  }

  await new Promise<void>((resolve) => {
    exec('taskkill /f /im SenaiStream.exe', () => resolve());
  });
}

export async function restartHost(): Promise<boolean> {
  await stopHost();
  await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  return await startHost();
}

export function isHostRunning(): boolean {
  return hostProcess !== null && !hostProcess.killed;
}

// ============================================================
// Virtual Display Driver Management (SenaiStreamDisplayCtl.exe)
// ============================================================

export function ensureVirtualDisplaySettingsSync(): void {
  try {
    const vddDir = 'C:\\VirtualDisplayDriver';
    if (!fs.existsSync(vddDir)) {
      fs.mkdirSync(vddDir, { recursive: true });
    }
    const infPath = getVirtualDisplayInfPath();
    const driverDir = path.dirname(infPath);

    // Sync all virtual driver files to C:\VirtualDisplayDriver
    const filesToSync = ['vdd_settings.xml', 'MttVDD.inf', 'MttVDD.dll', 'mttvdd.cat'];
    for (const f of filesToSync) {
      const src = path.join(driverDir, f);
      const dst = path.join(vddDir, f);
      if (fs.existsSync(src)) {
        if (!fs.existsSync(dst) || f === 'vdd_settings.xml') {
          try {
            fs.copyFileSync(src, dst);
          } catch {}
        }
      }
    }
    console.log('[VirtualDisplay] Driver files and 4-screen configuration synced to C:\\VirtualDisplayDriver');
  } catch (err) {
    console.warn('[VirtualDisplay] Warning syncing settings:', err);
  }
}

export async function getVirtualDisplayStatus(): Promise<VirtualDisplayStatus> {
  const ctlPath = getDisplayCtlExePath();
  const vddSettingsExist = fs.existsSync('C:\\VirtualDisplayDriver\\vdd_settings.xml');
  const displays = typeof screen !== 'undefined' && screen.getAllDisplays ? screen.getAllDisplays() : [];
  const hasMultipleDisplays = displays.length > 1;

  if (!fs.existsSync(ctlPath)) {
    return { installed: vddSettingsExist || hasMultipleDisplays, active: hasMultipleDisplays };
  }

  return new Promise((resolve) => {
    execFile(ctlPath, ['status'], (err) => {
      // Exit code 0 means device was found in DeviceSet
      const installed = !err || vddSettingsExist || hasMultipleDisplays;
      resolve({ installed, active: installed });
    });
  });
}

export async function installVirtualDisplayDriver(): Promise<{
  success: boolean;
  error?: string;
  rebootRequired?: boolean;
}> {
  const ctlPath = getDisplayCtlExePath();
  const infPath = getVirtualDisplayInfPath();

  if (!fs.existsSync(ctlPath)) {
    return { success: false, error: 'Utilitário SenaiStreamDisplayCtl não encontrado.' };
  }
  if (!fs.existsSync(infPath)) {
    return { success: false, error: 'Driver MttVDD.inf não encontrado.' };
  }

  console.log(`[VirtualDisplay] Installing / syncing driver via ensure: ${infPath}`);
  ensureVirtualDisplaySettingsSync();

  const batPath = path.join(path.dirname(infPath), '..', 'install_driver.bat');

  return new Promise((resolve) => {
    let psScript = '';
    if (fs.existsSync(batPath)) {
      const escapedBat = batPath.replace(/'/g, "''");
      psScript = `Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', '\`"${escapedBat}\`"' -Verb RunAs -Wait -PassThru`;
    } else {
      const escapedCtl = ctlPath.replace(/'/g, "''");
      const escapedInf = infPath.replace(/'/g, "''");
      psScript = `pnputil /add-driver '${escapedInf}' /install; Start-Process -FilePath '${escapedCtl}' -ArgumentList 'ensure', '\`"${escapedInf}\`"' -Verb RunAs -Wait -PassThru; pnputil /restart-device 'ROOT\\SENAISTREAM_VIRTUAL_DISPLAY\\0000'; pnputil /restart-device 'ROOT\\MTTVDD\\0000'; Start-Process -FilePath '${escapedCtl}' -ArgumentList 'extend' -Wait; DisplaySwitch.exe /extend`;
    }

    exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`, (err) => {
      if (err) {
        console.error('[VirtualDisplay] Failed to elevate driver installer:', err);
        resolve({ success: false, error: 'Falha ou cancelamento da permissão de administrador no Windows.' });
        return;
      }

      // Activate extended topology and restart device
      execFile(ctlPath, ['extend'], () => {});
      exec('DisplaySwitch.exe /extend', () => {});
      console.log('[VirtualDisplay] Virtual display setup command completed.');
      resolve({ success: true, rebootRequired: false });
    });
  });
}

export async function removeVirtualDisplayDriver(): Promise<{ success: boolean; error?: string }> {
  const ctlPath = getDisplayCtlExePath();
  if (!fs.existsSync(ctlPath)) {
    return { success: false, error: 'Utilitário SenaiStreamDisplayCtl não encontrado.' };
  }

  return new Promise((resolve) => {
    const escapedCtl = ctlPath.replace(/'/g, "''");
    const psScript = `(Start-Process -FilePath '${escapedCtl}' -ArgumentList 'remove' -Verb RunAs -Wait -PassThru).ExitCode`;
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`, (err, stdout) => {
      if (err) {
        resolve({ success: false, error: err.message });
        return;
      }
      const code = parseInt(stdout.trim(), 10);
      resolve({ success: code === 0 });
    });
  });
}

// ============================================================
// Display Mode Switching (Extended vs Duplicate)
// ============================================================

export async function setDisplayMode(
  mode: DisplayTopologyMode
): Promise<{ success: boolean; error?: string }> {
  console.log(`[GameStreamHost] Setting display mode to: ${mode}`);
  _currentDisplayMode = mode;

  // 1. Immediately apply to SenaiStream host settings (virtualDisplay & display 0)
  // When 'duplicate', virtualDisplay is false (streams primary laptop screen)
  // When 'extended', virtualDisplay is true (streams virtual extended display)
  await setHostSettings({
    virtualDisplay: mode === 'extended',
    display: 0,
  });

  const targetMode = mode === 'extended' ? 'extend' : 'duplicate';

  // 2. Notify SenaiStream loopback API
  await loopbackRequest('POST', '/api/display-mode', { mode: targetMode });

  // 3. Switch Windows topology using Windows 11 numeric switches:
  // 'DisplaySwitch.exe 2' = Duplicate / Clone
  // 'DisplaySwitch.exe 3' = Extend
  const winArg = mode === 'extended' ? '3' : '2';
  exec(`DisplaySwitch.exe ${winArg}`, () => {});

  // 4. Also call SenaiStreamDisplayCtl if available
  const ctlPath = getDisplayCtlExePath();
  if (fs.existsSync(ctlPath)) {
    execFile(ctlPath, [targetMode], () => {});
  }

  return { success: true };
}

// ============================================================
// Host Displays & Settings (REST API)
// ============================================================

export async function getHostDisplays(): Promise<HostDisplayInfo[]> {
  const list: HostDisplayInfo[] = [];

  // 1. Query Electron's native screen displays (exact physical monitors from OS)
  try {
    const electronDisplays = typeof screen !== 'undefined' && screen.getAllDisplays ? screen.getAllDisplays() : [];
    const primaryDisp = typeof screen !== 'undefined' && screen.getPrimaryDisplay ? screen.getPrimaryDisplay() : null;

    if (electronDisplays.length > 0) {
      for (let i = 0; i < electronDisplays.length; i++) {
        const d = electronDisplays[i];
        const isPrimary = primaryDisp ? d.id === primaryDisp.id : i === 0;
        const scale = d.scaleFactor || 1;
        const width = Math.round((d.bounds.width || d.size.width) * scale);
        const height = Math.round((d.bounds.height || d.size.height) * scale);

        list.push({
          index: i,
          name: isPrimary ? 'Tela Principal do PC (Notebook)' : `Monitor Secundário ${i}`,
          deviceName: isPrimary ? '\\\\.\\DISPLAY1' : `\\\\.\\DISPLAY${i + 1}`,
          width: width || 1920,
          height: height || 1080,
          primary: isPrimary,
          virtual: !isPrimary,
        });
      }
    }
  } catch (err) {
    console.warn('[GameStreamHost] Error reading electron screen displays:', err);
  }

  // 2. Query driver status: if MTT VDD virtual driver is installed, ensure virtual screen is listed
  try {
    const vddStatus = await getVirtualDisplayStatus();
    if (vddStatus.installed) {
      const hasVirtual = list.some((d) => d.virtual);
      if (!hasVirtual) {
        list.push({
          index: list.length,
          name: 'Segunda Tela Virtual (MTT VDD)',
          deviceName: '\\\\.\\DISPLAY_VIRTUAL',
          width: 1920,
          height: 1080,
          primary: false,
          virtual: true,
        });
      }
    }
  } catch {}

  if (list.length > 0) {
    return list;
  }

  // Fallback: SenaiStream loopback API
  const res = await loopbackRequest('GET', '/api/displays');
  if (res.status === 200 && res.data && Array.isArray(res.data.displays) && res.data.displays.length > 0) {
    return res.data.displays.map((d: any) => ({
      index: Number(d.index),
      name: d.primary ? 'Tela Principal do PC' : String(d.name || `Display ${d.index}`),
      deviceName: String(d.device_name || ''),
      width: Number(d.width || 1920),
      height: Number(d.height || 1080),
      primary: Boolean(d.primary),
      virtual: !d.primary,
    }));
  }

  return [
    {
      index: 0,
      name: 'Tela Principal (Computador)',
      deviceName: '\\\\.\\DISPLAY1',
      width: 1920,
      height: 1080,
      primary: true,
      virtual: false,
    },
  ];
}

export async function getHostSettings(): Promise<HostSettings> {
  const fallback: HostSettings = {
    display: 0,
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateMbps: 20,
    hardware: true,
    virtualDisplay: _currentDisplayMode === 'extended',
  };

  const res = await loopbackRequest('GET', '/api/settings');
  if (res.status === 200 && res.data) {
    return {
      display: Number(res.data.display ?? 0),
      width: Number(res.data.width ?? 1920),
      height: Number(res.data.height ?? 1080),
      fps: Number(res.data.fps ?? 60),
      bitrateMbps: Number(res.data.bitrateMbps ?? 20),
      hardware: Boolean(res.data.hardware ?? true),
      virtualDisplay: Boolean(res.data.virtualDisplay ?? (_currentDisplayMode === 'extended')),
    };
  }

  return fallback;
}

export async function setHostSettings(
  settings: Partial<HostSettings>
): Promise<{ success: boolean; error?: string }> {
  const current = await getHostSettings();
  const merged: HostSettings = {
    ...current,
    ...settings,
  };

  const res = await loopbackRequest('POST', '/api/settings', {
    display: merged.display,
    width: merged.width,
    height: merged.height,
    fps: merged.fps,
    bitrateMbps: merged.bitrateMbps,
    hardware: merged.hardware ? 1 : 0,
    virtualDisplay: merged.virtualDisplay ? 1 : 0,
  });

  if (res.status === 200) {
    return { success: true };
  }
  return { success: false, error: res.raw || 'Erro ao salvar configurações do host.' };
}

// ============================================================
// PIN Pairing & Clients
// ============================================================

export async function pairMoonlightPin(
  pin: string
): Promise<{ success: boolean; error?: string }> {
  const cleanPin = pin.trim();
  if (cleanPin.length !== 4) {
    return { success: false, error: 'O PIN deve conter exatamente 4 dígitos.' };
  }

  console.log(`[GameStreamHost] Submitting PIN: ${cleanPin}`);
  const res = await loopbackRequest('POST', '/api/pin', { pin: cleanPin });

  if (res.status === 200) {
    return { success: true };
  }

  return {
    success: false,
    error: res.raw || `Falha no pareamento (status ${res.status}). Verifique o PIN na tela da Smart TV.`,
  };
}

export async function getMoonlightClients(): Promise<MoonlightClient[]> {
  const clientsDir = getClientsDirectory();
  if (!fs.existsSync(clientsDir)) return [];

  try {
    const files = fs.readdirSync(clientsDir);
    return files
      .filter((f) => f.endsWith('.pem'))
      .map((f) => {
        const uuid = path.basename(f, '.pem');
        return {
          uuid,
          name: `Moonlight Client (${uuid.slice(0, 8)})`,
          enabled: true,
        };
      });
  } catch {
    return [];
  }
}

export async function removeMoonlightClient(
  uuid: string
): Promise<{ success: boolean; error?: string }> {
  const clientsDir = getClientsDirectory();
  const target = path.join(clientsDir, `${uuid}.pem`);

  try {
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      return { success: true };
    }
    // Try matching any file starting with uuid
    const files = fs.readdirSync(clientsDir);
    const matched = files.find((f) => f.includes(uuid));
    if (matched) {
      fs.unlinkSync(path.join(clientsDir, matched));
      return { success: true };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao remover cliente.' };
  }
}

// ============================================================
// Real-time Streaming Metrics
// ============================================================

export async function getStreamStats(): Promise<SunshineStreamStats> {
  const fallback: SunshineStreamStats = {
    isStreaming: false,
    fps: 0,
    bitrate: 0,
    resolution: { width: 1920, height: 1080 },
    activeClients: 0,
    encoder: 'GPU (Media Foundation)',
    uptime: 0,
    displayMode: 'extended',
  };

  try {
    const res = await loopbackRequest('GET', '/api/status');
    if (res.status !== 200 || !res.data) {
      return fallback;
    }

    const isActive = Boolean(res.data.active);
    if (isActive && !_streamingStartedAt) {
      _streamingStartedAt = Date.now();
    } else if (!isActive) {
      _streamingStartedAt = null;
    }

    const uptime = _streamingStartedAt ? Math.floor((Date.now() - _streamingStartedAt) / 1000) : 0;
    const settings = await getHostSettings();
    const encoder = await detectGpuEncoder();

    return {
      isStreaming: isActive,
      fps: isActive ? settings.fps : 0,
      bitrate: isActive ? settings.bitrateMbps * 1000 : 0,
      resolution: { width: settings.width, height: settings.height },
      activeClients: Number(res.data?.pairedClients ?? 0),
      encoder,
      uptime,
      displayMode: _currentDisplayMode,
    };
  } catch {
    return { ...fallback, displayMode: _currentDisplayMode };
  }
}

async function detectGpuEncoder(): Promise<string> {
  return new Promise((resolve) => {
    exec('wmic path win32_VideoController get name', (err, stdout) => {
      if (!err && stdout) {
        const lower = stdout.toLowerCase();
        if (lower.includes('nvidia') || lower.includes('geforce') || lower.includes('rtx')) {
          resolve('NVENC (Hardware)');
          return;
        }
        if (lower.includes('amd') || lower.includes('radeon')) {
          resolve('AMF (Hardware)');
          return;
        }
        if (lower.includes('intel') || lower.includes('iris') || lower.includes('arc')) {
          resolve('QuickSync (Hardware)');
          return;
        }
      }
      resolve('Media Foundation H.264');
    });
  });
}

// ============================================================
// Pairing Watcher (Notifies UI when TV asks for PIN)
// ============================================================

export function startPairingWatcher(
  onPairingRequested: (info: { name?: string }) => void
): void {
  if (_pairingWatcherTimer) return;

  _pairingWatcherTimer = setInterval(async () => {
    try {
      const res = await loopbackRequest('GET', '/api/status');
      if (res.status === 200 && res.data) {
        const waiting = Boolean(res.data.pairingWaiting);
        if (waiting && !_wasPairingWaiting) {
          console.log('[GameStreamHost] Client is waiting for PIN pairing!');
          onPairingRequested({ name: 'Smart TV / Moonlight' });
        }
        _wasPairingWaiting = waiting;
      }
    } catch {}
  }, 1000);
}

export function stopPairingWatcher(): void {
  if (_pairingWatcherTimer) {
    clearInterval(_pairingWatcherTimer);
    _pairingWatcherTimer = null;
  }
}

// ============================================================
// Backward-compatibility Wrappers for SunshineConfig & Screens
// ============================================================

export async function getSunshineConfig(): Promise<SunshineConfig> {
  const s = await getHostSettings();
  return {
    displayName: `SpaceViewer - ${os.hostname()}`,
    captureDisplayIndex: s.display,
    selectedSourceId: `screen:${s.display}`,
    fps: s.fps,
    resolution: { width: s.width, height: s.height },
  };
}

export async function setSunshineConfig(
  config: Partial<SunshineConfig>
): Promise<{ success: boolean; error?: string }> {
  const updates: Partial<HostSettings> = {};
  if (config.captureDisplayIndex !== undefined) updates.display = config.captureDisplayIndex;
  if (config.fps !== undefined) updates.fps = config.fps;
  if (config.resolution !== undefined) {
    updates.width = config.resolution.width;
    updates.height = config.resolution.height;
  }
  return await setHostSettings(updates);
}

export async function setMoonlightScreen(
  sourceId: string,
  _allSources: ScreenSource[]
): Promise<{ success: boolean; error?: string }> {
  let displayIndex = 0;
  if (sourceId.startsWith('screen:')) {
    const parts = sourceId.split(':');
    displayIndex = parseInt(parts[1] || '0', 10) || 0;
  }
  return await setHostSettings({ display: displayIndex });
}
