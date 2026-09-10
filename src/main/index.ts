// ============================================================
// ScreenFlow — Main Electron Entry Point
// ============================================================

import { app, BrowserWindow, ipcMain, screen } from 'electron';

// Disable WebRTC mDNS local IP hiding to ensure devices on local network can resolve raw IPs
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';
import Store from 'electron-store';
import { readInstallMode, saveInstallMode } from './installer';
import { SignalingServer } from './signaling';
import { NetworkDiscovery } from './discovery';
import { setupTray, destroyTray } from './tray';
import { ensurePrivateNetworkProfile, getCleanMdnsHostname, getPrimaryLANIPv4 } from './network-utils';
import { getAvailableScreens, getScreensDetailed, getAppWindows } from './capture';
import {
  startAppProjector,
  stopAppProjector,
  startObsProjector,
  stopObsProjector,
  getActiveProjectors,
  moveWindowToScreen,
  setProjectorChangeListener,
  getProjectorParamsForWindow,
} from './projector';
import {
  checkHostStatus,
  startHost,
  stopHost,
  restartHost,
  getVirtualDisplayStatus,
  getVirtualDisplayState,
  setVirtualDisplayCount,
  addVirtualDisplay,
  removeVirtualDisplay,
  toggleVirtualDisplays,
  installVirtualDisplayDriver,
  setDisplayMode,
  getHostDisplays,
  getHostSettings,
  setHostSettings,
  getMoonlightClients,
  removeMoonlightClient,
  pairMoonlightPin,
  startPairingWatcher,
  stopPairingWatcher,
  getStreamStats,
  getSunshineConfig,
  setSunshineConfig,
  setMoonlightScreen,
} from './gamestream-host';
import { AgentServer } from './agent-server';
import { TVDiscovery } from './tv-discovery';
import { checkForAppUpdates, downloadAndInstallUpdate, applyUpdateAndRestart } from './updater';
import type { AppSettings, InstallMode, MasterInfo } from '../shared/types';
import { DEFAULT_SETTINGS, APP_VERSION } from '../shared/constants';

let mainWindow: BrowserWindow | null = null;
let signalingServer: SignalingServer | null = null;
let discovery: NetworkDiscovery | null = null;
let agentServer: AgentServer | null = null;
let tvDiscovery: TVDiscovery | null = null;
let installMode: InstallMode = 'both';
let isQuitting = false;
let moonlightStatsTimer: NodeJS.Timeout | null = null;

const store = new Store<AppSettings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS,
});

async function applySettings(settings: AppSettings) {
  console.log('[ScreenFlow] Applying settings:', settings);

  try {
    // 1. Signaling Server
    if (installMode === 'master' || installMode === 'both') {
      if (!signalingServer) {
        signalingServer = new SignalingServer(settings.server.port);
        setupSignalingListeners();
        await signalingServer.start();
      } else if (settings.server.port !== (signalingServer as any).port) {
        await signalingServer.stop();
        signalingServer = new SignalingServer(settings.server.port);
        setupSignalingListeners();
        await signalingServer.start();
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
        setupAgentServerListeners();
        await agentServer.start();
      }
    } else {
      if (agentServer) {
        await agentServer.stop();
        agentServer = null;
      }
    }

    // 2. mDNS Discovery
    if (settings.server.enableMdns) {
      if (!discovery) {
        discovery = new NetworkDiscovery();
      }
      discovery.destroy(); // Reset

      if (installMode === 'master' || installMode === 'both') {
        const name = settings.server.networkInterface && settings.server.networkInterface !== 'auto'
          ? settings.server.networkInterface
          : app.getName();
        discovery.publishMaster(name, settings.server.port);
      }

      if (installMode === 'agent' || installMode === 'both') {
        if (agentServer && agentServer.isRunning) {
          const name = settings.server.networkInterface && settings.server.networkInterface !== 'auto'
            ? settings.server.networkInterface
            : os.hostname();
          discovery.publishAgent(name, (agentServer as any).port);
        }
      }
    } else {
      if (discovery) {
        discovery.destroy();
        discovery = null;
      }
    }
  } catch (err) {
    console.error('[ScreenFlow] Error applying settings:', err);
  }
}

function setupSignalingListeners() {
  if (!signalingServer) return;

  signalingServer.on('agent-connected', (agent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent-connected', agent);
    }
  });

  signalingServer.on('agent-disconnected', (id) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent-disconnected', id);
    }
  });

  signalingServer.on('agent-updated', (agent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent-connected', agent);
    }
  });

  signalingServer.on('signaling-message', (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('signaling-message', msg);
    }
  });
}

function setupAgentServerListeners() {
  if (!agentServer) return;

  agentServer.on('connect-request', (masterData) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[Main] Forwarding force-connect-to-master to renderer:', masterData);
      mainWindow.webContents.send('force-connect-to-master', masterData);
    }
  });
}

function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }
  return '127.0.0.1';
}

async function createWindow() {
  // Check and ensure network profile allows local discovery
  ensurePrivateNetworkProfile();

  // Read install mode
  installMode = await readInstallMode();
  const settings = store.store || DEFAULT_SETTINGS;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webSecurity: false,
    },
    backgroundColor: '#0A0F1E',
  });

  // Load URL or File
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Setup Tray
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

  // Initialize GameStream (Native SpaceviwerStream Host) automatically on startup
  if (installMode === 'master' || installMode === 'both' || !installMode) {
    startHost().then((success) => {
      console.log(`[Main] Native GameStream host auto-start result: ${success ? 'RUNNING' : 'FAILED'}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('gamestream-status-changed', success ? 'running' : 'stopped');
      }
    }).catch(console.error);

    // Start polling GameStream host for real-time stream stats every 2 seconds
    startMoonlightStatsPolling();

    // Start Smart TV Discovery engine
    if (!tvDiscovery) {
      tvDiscovery = new TVDiscovery();
      tvDiscovery.on('devices-updated', (tvs) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('smart-tvs-updated', tvs);
        }
      });
      tvDiscovery.start();
    }

    // Start watching for incoming Moonlight pairing requests from Smart TVs
    startPairingWatcher((info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('[Main] Bringing SpaceViewer to foreground for incoming pairing request');
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('moonlight-pairing-requested', info);
      }
    });
  }

  // Apply running settings
  await applySettings(settings);

  // Auto-start TV & Moonlight discovery in Master mode
  if (installMode === 'master' || installMode === 'both') {
    if (!tvDiscovery) {
      tvDiscovery = new TVDiscovery();
      tvDiscovery.on('devices-updated', (tvs) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('smart-tvs-updated', tvs);
        }
      });
      tvDiscovery.start();
    }
  }

  // Listen for screen/monitor topology changes (plug/unplug/virtual display switch)
  const notifyScreensChanged = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('screens-changed');
    }
  };
  screen.on('display-added', notifyScreensChanged);
  screen.on('display-removed', notifyScreensChanged);
  screen.on('display-metrics-changed', notifyScreensChanged);
  setProjectorChangeListener(notifyScreensChanged);
}

function startMoonlightStatsPolling() {
  if (moonlightStatsTimer) clearInterval(moonlightStatsTimer);
  moonlightStatsTimer = setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const stats = await getStreamStats();
      mainWindow.webContents.send('moonlight-stream-stats', stats);
    } catch {
      // ignore polling errors
    }
  }, 2000);
}

function stopMoonlightStatsPolling() {
  if (moonlightStatsTimer) {
    clearInterval(moonlightStatsTimer);
    moonlightStatsTimer = null;
  }
}

function cleanup() {
  destroyTray();
  stopMoonlightStatsPolling();
  stopPairingWatcher();
  if (signalingServer) {
    signalingServer.stop();
  }
  if (discovery) {
    discovery.destroy();
  }
  if (tvDiscovery) {
    tvDiscovery.stop();
    tvDiscovery = null;
  }
  if (agentServer) {
    agentServer.stop().catch(console.error);
  }
  stopObsProjector().catch(console.error);
  stopHost().catch(console.error);
}

// === IPC HANDLERS ===
function registerIpcHandlers() {
  // Screens & Application Projector
  ipcMain.handle('get-screens-detailed', async () => {
    return await getScreensDetailed();
  });

  ipcMain.handle('get-app-windows', async () => {
    return await getAppWindows();
  });

  ipcMain.handle('start-app-projector', async (_, sourceId: string, appName: string, displayId: string) => {
    return await startAppProjector(sourceId, appName, displayId);
  });

  ipcMain.handle('start-obs-projector', async (_, sourceId: string, appName: string, displayId: string) => {
    return await startAppProjector(sourceId, appName, displayId);
  });

  ipcMain.handle('stop-app-projector', async (_, displayId?: string) => {
    return await stopAppProjector(displayId);
  });

  ipcMain.handle('stop-obs-projector', async (_, displayId?: string) => {
    return await stopAppProjector(displayId);
  });

  ipcMain.handle('get-projector-params', (event) => {
    return getProjectorParamsForWindow(event.sender.id);
  });

  ipcMain.handle('get-active-projectors', async () => {
    return getActiveProjectors();
  });

  ipcMain.handle('move-window-to-screen', async (_, windowName: string, displayId: string, sourceId?: string) => {
    return await moveWindowToScreen(windowName, displayId, sourceId);
  });

  // Master
  ipcMain.handle('get-screens', async () => {
    return await getAvailableScreens();
  });

  // Master: scan for agents
  ipcMain.handle('discover-agents', async () => {
    console.log('[Main] Master started agent discovery');
    if (!discovery) {
      discovery = new NetworkDiscovery();
    }
    discovery.discoverAgents((agent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent-discovered', agent);
      }
    });
    return [];
  });

  // Master: invite an agent manually
  ipcMain.handle('invite-agent', async (_, ip: string, port: number) => {
    console.log(`[Main] Inviting agent at ${ip}:${port}`);
    const settings = store.store || DEFAULT_SETTINGS;
    const masterPort = settings.server.port;
    const masterName = settings.server.networkInterface && settings.server.networkInterface !== 'auto'
      ? settings.server.networkInterface
      : os.hostname();

    const localIp = getLocalIpAddress();

    return new Promise((resolve) => {
      const url = `http://${ip}:${port}/connect-to-master?host=${localIp}&port=${masterPort}&name=${encodeURIComponent(masterName)}`;
      console.log(`[Main] Sending invite request to: ${url}`);
      
      const req = http.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: `Server responded with status ${res.statusCode}: ${data}` });
          }
        });
      });

      req.on('error', (err) => {
        console.error('[Main] Failed to invite agent:', err);
        resolve({ success: false, error: err.message });
      });

      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ success: false, error: 'Invitation request timed out' });
      });
    });
  });

  // Moonlight / GameStream (Native SpaceviwerStream Host)
  ipcMain.handle('check-sunshine', async () => {
    return await checkHostStatus();
  });

  ipcMain.handle('start-gamestream', async () => {
    console.log('[Main] Start GameStream (SpaceviwerStream)');
    const success = await startHost();
    if (success && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gamestream-status-changed', 'running');
    }
    return success;
  });

  ipcMain.handle('stop-gamestream', async () => {
    console.log('[Main] Stop GameStream (SpaceviwerStream)');
    await stopHost();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gamestream-status-changed', 'stopped');
    }
  });

  ipcMain.handle('get-gamestream-status', async () => {
    const status = await checkHostStatus();
    return status === 'running' ? 'running' : 'stopped';
  });

  ipcMain.handle('get-host-info', () => {
    return {
      hostname: getCleanMdnsHostname(),
      rawHostname: os.hostname(),
      ip: getPrimaryLANIPv4(),
    };
  });

  // Extended Virtual Display & Native Controls
  ipcMain.handle('get-virtual-display-status', async () => {
    return await getVirtualDisplayStatus();
  });

  ipcMain.handle('get-virtual-display-state', async () => {
    return await getVirtualDisplayState();
  });

  ipcMain.handle('set-virtual-display-count', async (_, count: number) => {
    return await setVirtualDisplayCount(count);
  });

  ipcMain.handle('add-virtual-display', async () => {
    return await addVirtualDisplay();
  });

  ipcMain.handle('remove-virtual-display', async () => {
    return await removeVirtualDisplay();
  });

  ipcMain.handle('toggle-virtual-displays', async (_, enabled: boolean) => {
    return await toggleVirtualDisplays(enabled);
  });

  ipcMain.handle('install-virtual-display-driver', async () => {
    return await installVirtualDisplayDriver();
  });

  ipcMain.handle('set-display-mode', async (_, mode) => {
    return await setDisplayMode(mode);
  });

  ipcMain.handle('get-host-displays', async () => {
    return await getHostDisplays();
  });

  ipcMain.handle('get-host-settings', async () => {
    return await getHostSettings();
  });

  ipcMain.handle('set-host-settings', async (_, settings) => {
    return await setHostSettings(settings);
  });

  // Moonlight — Screen Selection
  ipcMain.handle('get-moonlight-screens', async () => {
    return await getAvailableScreens();
  });

  ipcMain.handle('set-moonlight-screen', async (_, sourceId: string) => {
    console.log('[Main] Set Moonlight screen source:', sourceId);
    const allScreens = await getAvailableScreens();
    return await setMoonlightScreen(sourceId, allScreens);
  });

  // Moonlight — Clients
  ipcMain.handle('get-moonlight-clients', async () => {
    return await getMoonlightClients();
  });

  ipcMain.handle('remove-moonlight-client', async (_, uuid: string) => {
    return await removeMoonlightClient(uuid);
  });

  // Moonlight / Smart TVs — Discovery
  ipcMain.handle('discover-smart-tvs', async () => {
    if (!tvDiscovery) {
      tvDiscovery = new TVDiscovery();
      tvDiscovery.on('devices-updated', (tvs) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('smart-tvs-updated', tvs);
        }
      });
      tvDiscovery.start();
    }
    tvDiscovery.triggerScan();
    return await tvDiscovery.getDiscoveredTVs();
  });

  // Moonlight — Stream Stats
  ipcMain.handle('get-sunshine-stream-stats', async () => {
    return await getStreamStats();
  });

  // Moonlight — Configuration
  ipcMain.handle('get-sunshine-config', async () => {
    return await getSunshineConfig();
  });

  ipcMain.handle('set-sunshine-config', async (_, config: any) => {
    return await setSunshineConfig(config);
  });

  ipcMain.handle('pair-moonlight-pin', async (_, pin: string) => {
    console.log(`[Main] Attempting to pair Moonlight PIN: ${pin}`);
    const result = await pairMoonlightPin(pin);
    // After pairing, trigger a TV scan refresh so the TV status turns to Paired immediately
    if (result.success && tvDiscovery) {
      setTimeout(() => tvDiscovery?.triggerScan(), 1000);
    }
    return result;
  });

  ipcMain.handle('start-capture', async (_, config) => {
    console.log('[Main] Start Capture:', config);
    if (signalingServer) {
      signalingServer.broadcast({
        type: 'stream-start',
        payload: config,
      });
    }
    return true;
  });

  ipcMain.handle('stop-capture', async () => {
    console.log('[Main] Stop Capture');
    if (signalingServer) {
      signalingServer.broadcast({
        type: 'stream-stop',
        payload: { reason: 'stopped' },
      });
    }
  });

  ipcMain.handle('pause-capture', async () => {
    console.log('[Main] Pause Capture');
    if (signalingServer) {
      signalingServer.broadcast({
        type: 'stream-stop',
        payload: { reason: 'paused' },
      });
    }
  });

  ipcMain.handle('get-network-addresses', async () => {
    if (signalingServer) {
      return signalingServer.getLocalAddresses();
    }
    // Fallback if signaling server not initialized
    const s = new SignalingServer();
    return s.getLocalAddresses();
  });

  ipcMain.handle('get-server-status', async () => {
    if (signalingServer && signalingServer.isRunning) {
      return 'running';
    }
    return 'stopped';
  });

  ipcMain.handle('get-connected-agents', async () => {
    if (signalingServer) {
      return signalingServer.getAgentsList();
    }
    return [];
  });

  ipcMain.handle('disconnect-agent', async (_, id) => {
    if (signalingServer) {
      signalingServer.disconnectAgentById(id);
    }
  });

  ipcMain.handle('accept-agent', async (_, id) => {
    if (signalingServer) {
      signalingServer.acceptAgent(id);
    }
  });

  ipcMain.handle('send-message', async (_, id, msg) => {
    if (signalingServer) {
      try {
        const parsed = JSON.parse(msg);
        signalingServer.sendToAgent(id, parsed);
      } catch {
        signalingServer.sendToAgent(id, { type: 'signaling-message', payload: msg });
      }
    }
  });

  // Agent Discovery
  ipcMain.handle('discover-masters', async () => {
    console.log('[Main] Agent started discovery');
    if (!discovery) {
      discovery = new NetworkDiscovery();
    }
    // Start browsing and forward to renderer
    discovery.discoverMasters((master) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('master-discovered', master);
      }
    });
    return [];
  });

  let currentMasterInfo: MasterInfo | null = null;
  ipcMain.handle('connect-to-master', async (_, info: MasterInfo) => {
    console.log('[Main] Connect to master:', info);
    currentMasterInfo = info;
    return true;
  });

  ipcMain.handle('disconnect-from-master', async () => {
    console.log('[Main] Disconnect from master');
    currentMasterInfo = null;
  });

  // Shared
  ipcMain.handle('get-install-mode', async () => {
    return installMode;
  });

  ipcMain.handle('set-install-mode', async (_, mode: InstallMode) => {
    installMode = mode;
    await saveInstallMode(mode);
    console.log('[Main] Install mode set to:', mode);
    // Restart signaling / discovery services based on new mode
    const settings = store.store || DEFAULT_SETTINGS;
    await applySettings(settings);
  });

  ipcMain.handle('save-settings', async (_, settings: AppSettings) => {
    store.store = settings;
    await applySettings(settings);
  });

  ipcMain.handle('get-settings', async () => {
    return store.store || DEFAULT_SETTINGS;
  });

  ipcMain.handle('get-app-version', async () => {
    return APP_VERSION;
  });

  // Auto-Update
  ipcMain.handle('updater:check', async () => {
    return await checkForAppUpdates();
  });

  ipcMain.handle('updater:download-and-install', async (_, downloadUrl: string) => {
    return await downloadAndInstallUpdate(downloadUrl, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:progress', progress);
      }
    });
  });

  ipcMain.handle('updater:apply-and-restart', async () => {
    return await applyUpdateAndRestart();
  });

  // Window actions
  ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.on('toggle-fullscreen', (_, state: boolean) => {
    if (mainWindow) mainWindow.setFullScreen(state);
  });
}

// App lifecycle
app.on('before-quit', () => {
  isQuitting = true;
});

// Prevent multiple instances — second instance focuses existing window
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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    cleanup();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
