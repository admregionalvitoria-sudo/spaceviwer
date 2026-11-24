// SpaceViewer v3.1.0
// ============================================================
// SpaceViewer — Main Electron Entry Point
// ============================================================

// Catch non-fatal network interface / mDNS / UDP broadcast exceptions (e.g. EADDRNOTAVAIL 224.0.0.251:5353)
process.on('uncaughtException', (err: any) => {
  const msg = err?.message || String(err);
  if (
    msg.includes('EADDRNOTAVAIL') ||
    msg.includes('ENETUNREACH') ||
    msg.includes('EHOSTUNREACH') ||
    msg.includes('EADDRINUSE') ||
    msg.includes('224.0.0.251') ||
    msg.includes('5353') ||
    msg.includes('1900') ||
    msg.includes('239.255.255.250')
  ) {
    console.warn('[SpaceViewer] Handled non-fatal network socket exception:', msg);
    return;
  }
  console.error('[SpaceViewer] Uncaught Exception in main process:', err);
});

process.on('unhandledRejection', (reason: any) => {
  console.warn('[SpaceViewer] Unhandled Promise Rejection in main process:', reason);
});

import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';

// Disable WebRTC mDNS local IP hiding to ensure devices on local network can resolve raw IPs
// and disable background throttling / occlusion so capture and encode stay at full speed when window is hidden
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns,CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import Store from 'electron-store';
import { readInstallMode, saveInstallMode } from './installer';
import { setAutostart } from './autostart';
import { SignalingServer } from './signaling';
import { NetworkDiscovery } from './discovery';
import { setupTray, destroyTray } from './tray';
import { createSafeBonjour, ensurePrivateNetworkProfile, getCleanMdnsHostname, getPrimaryLANIPv4 } from './network-utils';
import { getAvailableScreens, getScreensDetailed, getAppWindows } from './capture';
import {
  startAppProjector,
  stopAppProjector,
  stopObsProjector,
  getActiveProjectors,
  moveWindowToScreen,
  setProjectorChangeListener,
  getProjectorParamsForWindow,
  refreshProjectorDisplays,
} from './projector';
import {
  listPcDisplays,
  getVirtualDriverState,
  installVirtualDriver,
  setDisplayMode,
  setDisplayPosition,
  setPrimaryDisplay,
} from './display-topology';
import { detachAllVirtualOutputs, invalidateDisplayInventory } from './windows-displays';
import { DisplayReceivers } from './display-receivers';
import { DisplaySessions } from './display-sessions';
import { AgentServer } from './agent-server';
import { checkForAppUpdates, downloadAndInstallUpdate, applyUpdateAndRestart } from './updater';
import { ensureVirtualDisplayCursorVisible, restoreNormalCursor } from './cursor-manager';
import { raiseAppPriority } from './process-priority';
import { getDiagnosticsDir } from './diagnostics-log';
import type { AppSettings, InstallMode, MasterInfo, ReceiverAssignment, ReceiverMode } from '../shared/types';
import { DEFAULT_SETTINGS, APP_VERSION, APK_FILE_NAME } from '../shared/constants';

let mainWindow: BrowserWindow | null = null;
let signalingServer: SignalingServer | null = null;
let discovery: NetworkDiscovery | null = null;
let agentServer: AgentServer | null = null;
let receivers: DisplayReceivers | null = null;
let sessions: DisplaySessions | null = null;
let installMode: InstallMode = 'both';
let isQuitting = false;
/** Why the signaling server is not listening (shown when a receiver cannot connect). */
let signalingError: string | null = null;

const store = new Store<AppSettings & { migrations?: Record<string, boolean> }>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS,
});

// One-time migration: switch previous default ('native') to 'webrtc' while preserving future user choices.
if (!store.get('migrations.webrtcDefaultV321')) {
  const savedDisplay = store.get('display') as Partial<AppSettings['display']> | undefined;
  if (savedDisplay && savedDisplay.transport === 'native') {
    store.set('display.transport', 'webrtc');
  }
  store.set('migrations.webrtcDefaultV321', true);
}

/** Settings with defaults for sections added in newer versions (e.g. `display`). */
function currentSettings(): AppSettings {
  const raw = (store.store || {}) as Partial<AppSettings> & { migrations?: Record<string, boolean> };
  const { migrations: _migrations, ...saved } = raw;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    display: {
      ...DEFAULT_SETTINGS.display,
      transport: saved.display?.transport ?? DEFAULT_SETTINGS.display.transport,
      totalBitrateKbps: saved.display?.totalBitrateKbps ?? DEFAULT_SETTINGS.display.totalBitrateKbps,
      ...(saved.display || {}),
      quality: { ...DEFAULT_SETTINGS.display.quality, ...(saved.display?.quality || {}) },
      audio: { ...DEFAULT_SETTINGS.display.audio, ...(saved.display?.audio || {}) },
    },
  } as AppSettings;
}

function send(channel: string, payload?: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function apkPath(): string | null {
  const candidates = [
    ...(app.isPackaged ? [path.join(process.resourcesPath, 'apk', APK_FILE_NAME)] : []),
    path.join(app.getAppPath(), 'resources', 'apk', APK_FILE_NAME),
    path.join(process.cwd(), 'resources', 'apk', APK_FILE_NAME),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const masterEnabled = () => installMode === 'master' || installMode === 'both';

function createSignalingServer(port: number) {
  const server = new SignalingServer(port, {
    isExpectedDisplay: (sessionId, deviceId) => sessions?.isExpectedSession(sessionId, deviceId) ?? false,
    apkPath,
  });
  server.on('agent-connected', (agent) => send('agent-connected', agent));
  server.on('agent-disconnected', (id) => send('agent-disconnected', id));
  server.on('agent-updated', (agent) => send('agent-connected', agent));
  server.on('signaling-message', (msg) => send('signaling-message', msg));
  server.on('display-connected', (event) => sessions?.onDisplayConnected(event));
  server.on('display-message', (event) => sessions?.onDisplayMessage(event));
  server.on('display-disconnected', (event) => sessions?.onDisplayDisconnected(event));
  server.on('error', (error: Error) => console.error('[SpaceViewer] Signaling server error:', error.message));
  return server;
}

function ensureReceivers() {
  if (receivers) return;
  receivers = new DisplayReceivers(undefined, () => createSafeBonjour({ reuseAddr: true }));
  sessions = new DisplaySessions({ settings: currentSettings, signaling: () => signalingServer, signalingError: () => signalingError, receivers });
  sessions.on('updated', (list) => send('display-receivers-updated', list));
  sessions.on('session-ready', (ready) => {
    raiseAppPriority();
    send('display-session-ready', ready);
  });
  sessions.on('session-ended', (info) => send('display-session-ended', info));
  sessions.on('signal', (msg) => send('signaling-message', msg));
  sessions.on('notice', (message: string) => send('connection-error', message));
  sessions.on('native-audio-state', (payload) => send('native-audio-state', payload));
  receivers.start();
  detachAllVirtualOutputs().catch(() => {});
}

async function applySettings(settings: AppSettings) {
  console.log('[SpaceViewer] Applying settings');

  try {
    await setAutostart(settings.startup.launchWithWindows);
    // 1. Signaling Server (WebRTC signaling for PC agents and Android receivers)
    if (masterEnabled()) {
      // Discovery works without the signaling port, so the device list is available even if the port is taken.
      ensureReceivers();
      if (!signalingServer || !signalingServer.isRunning || settings.server.port !== signalingServer.listeningPort) {
        if (signalingServer) await signalingServer.stop().catch(() => {});
        signalingServer = createSignalingServer(settings.server.port);
        try {
          await signalingServer.start();
          signalingError = null;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          signalingError = code === 'EADDRINUSE'
            ? `A porta ${settings.server.port} já está em uso (outra cópia do SpaceViewer aberta?). Feche-a ou troque a porta em Opções → Servidor.`
            : `Não foi possível abrir a porta ${settings.server.port}: ${(error as Error).message}`;
          console.error('[SpaceViewer]', signalingError);
          send('connection-error', signalingError);
        }
      }
    } else {
      if (signalingServer) {
        await signalingServer.stop();
        signalingServer = null;
      }
    }

    // 1b. Agent HTTP Server
    if (installMode === 'agent' || installMode === 'both') {
      if (!agentServer) {
        agentServer = new AgentServer();
        agentServer.on('connect-request', (masterData) => send('force-connect-to-master', masterData));
        await agentServer.start();
      }
    } else if (agentServer) {
      await agentServer.stop();
      agentServer = null;
    }

    // 2. mDNS Discovery (PC master/agent)
    if (settings.server.enableMdns) {
      if (!discovery) discovery = new NetworkDiscovery();
      discovery.destroy(); // Reset

      if (masterEnabled()) {
        const name = settings.server.networkInterface && settings.server.networkInterface !== 'auto'
          ? settings.server.networkInterface
          : app.getName();
        discovery.publishMaster(name, settings.server.port);
      }

      if ((installMode === 'agent' || installMode === 'both') && agentServer?.isRunning) {
        const name = settings.server.networkInterface && settings.server.networkInterface !== 'auto'
          ? settings.server.networkInterface
          : os.hostname();
        discovery.publishAgent(name, (agentServer as any).port);
      }
    } else if (discovery) {
      discovery.destroy();
      discovery = null;
    }
  } catch (err) {
    console.error('[SpaceViewer] Error applying settings:', err);
  }
}

function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return '127.0.0.1';
}

async function createWindow() {
  // Check and ensure network profile allows local discovery
  ensurePrivateNetworkProfile();

  installMode = await readInstallMode();
  const settings = currentSettings();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 660,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webSecurity: false,
      // Keep capture/encoding at full rate while the window is minimized or hidden in the tray.
      backgroundThrottling: false,
    },
    backgroundColor: '#0A0F1E',
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting && store.get('startup.minimizeToTray')) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Enable F12 (DevTools) and F5 / Ctrl+R (Reload) for easy troubleshooting and recovery
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && (input.key === 'I' || input.key === 'i'))) {
      if (mainWindow?.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow?.webContents.openDevTools({ mode: 'detach' });
      }
    } else if (input.key === 'F5' || (input.control && (input.key === 'R' || input.key === 'r'))) {
      mainWindow?.reload();
    }
  });

  // Auto-recover if renderer process crashes or hangs
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.warn('[Main] Render process gone:', details);
    if (!mainWindow?.isDestroyed()) mainWindow?.reload();
  });

  // A reload drops every renderer peer: restart the receiver streams once it is back.
  mainWindow.webContents.on('did-finish-load', () => {
    sessions?.onRendererReloaded();
    send('native-audio-state', { enabled: sessions?.hasNativeAudio() ?? false });
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[Main] Window load failed:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) console.warn(`[Renderer Console] ${message} (${sourceId}:${line})`);
  });

  setupTray(installMode, mainWindow, {
    onPauseStream: () => {
      if (signalingServer) signalingServer.pauseAll();
    },
    onResumeStream: () => {
      // Stream can be resumed from renderer
    },
    onQuit: () => {
      isQuitting = true;
      cleanup();
    },
  });

  await applySettings(settings);

  // Listen for screen/monitor topology changes (plug/unplug/virtual display switch)
  let displayChangeTimer: NodeJS.Timeout | undefined;
  const onDisplayChange = () => {
    if (displayChangeTimer) clearTimeout(displayChangeTimer);
    displayChangeTimer = setTimeout(() => {
      invalidateDisplayInventory();
      refreshProjectorDisplays();
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('screens-changed');
    }, 500);
  };
  screen.on('display-added', onDisplayChange);
  screen.on('display-removed', onDisplayChange);
  screen.on('display-metrics-changed', onDisplayChange);
  setProjectorChangeListener(() => send('screens-changed'));

  raiseAppPriority();
}

async function cleanup() {
  destroyTray();
  await sessions?.shutdown().catch(() => {});
  receivers?.stop();
  if (signalingServer) signalingServer.stop();
  if (discovery) discovery.destroy();
  if (agentServer) agentServer.stop().catch(console.error);
  stopObsProjector().catch(console.error);
}

// === IPC HANDLERS ===
function registerIpcHandlers() {
  // Screens & Application Projector
  ipcMain.handle('get-screens-detailed', async () => getScreensDetailed());
  ipcMain.handle('get-app-windows', async () => getAppWindows());
  ipcMain.handle('start-app-projector', async (_, sourceId: string, appName: string, displayId: string) => startAppProjector(sourceId, appName, displayId));
  ipcMain.handle('stop-app-projector', async (_, displayId?: string) => stopAppProjector(displayId));
  ipcMain.handle('get-projector-params', (event) => getProjectorParamsForWindow(event.sender.id));
  ipcMain.handle('get-active-projectors', async () => getActiveProjectors());
  ipcMain.handle('move-window-to-screen', async (_, windowName: string, displayId: string, sourceId?: string) => moveWindowToScreen(windowName, displayId, sourceId));

  // Master
  ipcMain.handle('get-screens', async () => getAvailableScreens());

  // Master: scan for PC agents
  ipcMain.handle('discover-agents', async () => {
    if (!discovery) discovery = new NetworkDiscovery();
    discovery.discoverAgents((agent) => send('agent-discovered', agent));
    return [];
  });

  // Master: invite a PC agent manually
  ipcMain.handle('invite-agent', async (_, ip: string, port: number) => {
    const settings = currentSettings();
    const masterName = settings.server.networkInterface && settings.server.networkInterface !== 'auto'
      ? settings.server.networkInterface
      : os.hostname();
    const url = `http://${ip}:${port}/connect-to-master?host=${getLocalIpAddress()}&port=${settings.server.port}&name=${encodeURIComponent(masterName)}`;
    return new Promise((resolve) => {
      const req = http.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(res.statusCode === 200 ? { success: true } : { success: false, error: `Server responded with status ${res.statusCode}: ${data}` }));
      });
      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ success: false, error: 'Invitation request timed out' });
      });
    });
  });

  // PC displays
  ipcMain.handle('list-pc-displays', () => listPcDisplays(sessions?.displayAssignments() ?? {}));
  ipcMain.handle('get-virtual-driver-state', () => getVirtualDriverState());
  ipcMain.handle('install-virtual-driver', () => installVirtualDriver());
  ipcMain.handle('set-display-resolution', (_, deviceName: string, width: number, height: number, refreshRate: number) => setDisplayMode(deviceName, width, height, refreshRate));
  ipcMain.handle('set-display-position', (_, deviceName: string, x: number, y: number) => setDisplayPosition(deviceName, x, y));
  ipcMain.handle('set-primary-display', (_, deviceName: string) => setPrimaryDisplay(deviceName));
  ipcMain.handle('ensure-virtual-cursor', () => ensureVirtualDisplayCursorVisible());
  ipcMain.handle('restore-normal-cursor', () => restoreNormalCursor());
  ipcMain.handle('get-host-info', () => {
    const ip = getPrimaryLANIPv4();
    const port = signalingServer?.listeningPort ?? currentSettings().server.port;
    return {
      hostname: getCleanMdnsHostname(),
      rawHostname: os.hostname(),
      ip,
      apkUrl: apkPath() && ip ? `http://${ip}:${port}/apk` : null,
    };
  });

  // Android receivers
  const needSessions = () => {
    if (!sessions) throw new Error('As telas sem fio só funcionam no modo Transmissor.');
    return sessions;
  };
  ipcMain.handle('list-receivers', () => sessions?.list() ?? []);
  ipcMain.handle('scan-receivers', async () => {
    if (!receivers) return [];
    await receivers.scan();
    return sessions?.list() ?? [];
  });
  ipcMain.handle('add-receiver-by-ip', async (_, ip: string) => {
    try {
      if (!receivers) throw new Error('As telas sem fio só funcionam no modo Transmissor.');
      await receivers.addManual(ip);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
  ipcMain.handle('set-receiver-assignment', (_, id: string, assignment: Partial<ReceiverAssignment>) => needSessions().setAssignment(id, assignment));
  ipcMain.handle('connect-receiver', (_, id: string) => needSessions().connect(id));
  ipcMain.handle('disconnect-receiver', (_, id: string) => needSessions().disconnect(id));
  ipcMain.handle('apply-receivers-mode', (_, ids: string[], mode: ReceiverMode, sourceDisplayId?: string) => needSessions().applyMode(ids, mode, sourceDisplayId));
  ipcMain.handle('disconnect-all-receivers', () => needSessions().disconnectAll());
  ipcMain.on('report-receiver-status', (_, receiverId: string, status: 'streaming' | 'error', error?: string) => sessions?.reportStatus(receiverId, status, error));
  ipcMain.on('report-receiver-notice', (_, receiverId: string, message: string) => sessions?.reportNotice(receiverId, message));

  // Native audio from renderer
  ipcMain.on('native-audio-chunk', (_, chunk) => {
    if (!sessions) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sessions.onNativeAudio(buf);
  });

  // PC agent streaming (WebRTC to SpaceViewer desktop receivers)
  ipcMain.handle('start-capture', async (_, config) => {
    signalingServer?.broadcast({ type: 'stream-start', payload: config });
    return true;
  });
  ipcMain.handle('stop-capture', async () => {
    signalingServer?.broadcast({ type: 'stream-stop', payload: { reason: 'stopped' } });
  });
  ipcMain.handle('pause-capture', async () => {
    signalingServer?.broadcast({ type: 'stream-stop', payload: { reason: 'paused' } });
  });

  ipcMain.handle('get-network-addresses', async () => (signalingServer ?? new SignalingServer()).getLocalAddresses());
  ipcMain.handle('get-server-status', async () => (signalingServer?.isRunning ? 'running' : 'stopped'));
  ipcMain.handle('get-connected-agents', async () => signalingServer?.getAgentsList() ?? []);
  ipcMain.handle('disconnect-agent', async (_, id) => { signalingServer?.disconnectAgentById(id); });
  ipcMain.handle('accept-agent', async (_, id) => { signalingServer?.acceptAgent(id); });
  ipcMain.handle('send-message', async (_, id, msg) => {
    if (!signalingServer) return;
    try {
      signalingServer.sendToAgent(id, JSON.parse(msg));
    } catch {
      signalingServer.sendToAgent(id, { type: 'signaling-message', payload: msg });
    }
  });

  // Agent Discovery
  ipcMain.handle('discover-masters', async () => {
    if (!discovery) discovery = new NetworkDiscovery();
    discovery.discoverMasters((master) => send('master-discovered', master));
    return [];
  });

  ipcMain.handle('connect-to-master', async (_, info: MasterInfo) => {
    console.log('[Main] Connect to master:', info);
    return true;
  });

  ipcMain.handle('disconnect-from-master', async () => {
    console.log('[Main] Disconnect from master');
  });

  // Shared
  ipcMain.handle('get-install-mode', async () => installMode);

  ipcMain.handle('set-install-mode', async (_, mode: InstallMode) => {
    installMode = mode;
    await saveInstallMode(mode);
    await applySettings(currentSettings());
  });

  ipcMain.handle('save-settings', async (_, settings: AppSettings) => {
    const previousTransport = currentSettings().display.transport;
    const previousQuality = JSON.stringify(currentSettings().display.quality);
    const previousAudio = JSON.stringify(currentSettings().display.audio);
    const previousTotalBitrate = currentSettings().display.totalBitrateKbps;
    const existingMigrations = store.get('migrations');
    store.store = existingMigrations ? ({ ...settings, migrations: existingMigrations } as any) : settings;
    await applySettings(currentSettings());
    if (
      currentSettings().display.transport !== previousTransport ||
      JSON.stringify(currentSettings().display.quality) !== previousQuality ||
      JSON.stringify(currentSettings().display.audio) !== previousAudio ||
      currentSettings().display.totalBitrateKbps !== previousTotalBitrate
    ) {
      sessions?.onGlobalQualityChanged();
    }
  });

  ipcMain.handle('get-settings', async () => currentSettings());
  ipcMain.handle('get-app-version', async () => APP_VERSION);
  ipcMain.handle('open-diagnostics-folder', async () => {
    const dir = getDiagnosticsDir();
    await shell.openPath(dir);
    return { success: true };
  });

  // Auto-Update
  ipcMain.handle('updater:check', async () => checkForAppUpdates());
  ipcMain.handle('updater:download-and-install', async (_, downloadUrl: string) =>
    downloadAndInstallUpdate(downloadUrl, (progress) => send('updater:progress', progress)));
  ipcMain.handle('updater:apply-and-restart', async () => applyUpdateAndRestart());

  // Window actions
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window-close', () => mainWindow?.close());
  ipcMain.on('toggle-fullscreen', (_, state: boolean) => mainWindow?.setFullScreen(state));
}

function startAutomaticUpdateChecker() {
  const check = () => {
    checkForAppUpdates()
      .then((info) => {
        if (info && info.updateAvailable) send('updater:available-auto', info);
      })
      .catch((err) => console.error('[Updater] Background check error:', err));
  };
  setTimeout(check, 5000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

// App lifecycle
let cleanedForQuit = false;
app.on('before-quit', (event) => {
  isQuitting = true;
  if (!cleanedForQuit) {
    event.preventDefault();
    // Disconnect receivers and remove virtual displays before exiting.
    cleanup().catch(console.error).finally(() => { cleanedForQuit = true; app.quit(); });
  }
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    registerIpcHandlers();
    await createWindow();
    restoreNormalCursor().catch(() => {});
    startAutomaticUpdateChecker();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
