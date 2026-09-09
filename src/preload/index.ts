// ============================================================
// ScreenFlow — Preload Script (contextBridge)
// ============================================================

import { contextBridge, ipcRenderer } from 'electron';
import type { ScreenFlowAPI } from '../shared/types';

const api: ScreenFlowAPI = {
  // === SCREENS & APPLICATION PROJECTOR ===
  getScreensDetailed: () => ipcRenderer.invoke('get-screens-detailed'),
  getAppWindows: () => ipcRenderer.invoke('get-app-windows'),
  startAppProjector: (sourceId, appName, displayId) =>
    ipcRenderer.invoke('start-app-projector', sourceId, appName, displayId),
  startObsProjector: (sourceId, appName, displayId) =>
    ipcRenderer.invoke('start-app-projector', sourceId, appName, displayId),
  stopAppProjector: (displayId) => ipcRenderer.invoke('stop-app-projector', displayId),
  stopObsProjector: (displayId) => ipcRenderer.invoke('stop-app-projector', displayId),
  getProjectorParams: () => ipcRenderer.invoke('get-projector-params'),
  getActiveProjectors: () => ipcRenderer.invoke('get-active-projectors'),
  moveWindowToScreen: (windowName, displayId, sourceId) =>
    ipcRenderer.invoke('move-window-to-screen', windowName, displayId, sourceId),

  // === MASTER ===
  getScreens: () => ipcRenderer.invoke('get-screens'),
  startCapture: (config) => ipcRenderer.invoke('start-capture', config),
  stopCapture: () => ipcRenderer.invoke('stop-capture'),
  pauseCapture: () => ipcRenderer.invoke('pause-capture'),

  getNetworkAddresses: () => ipcRenderer.invoke('get-network-addresses'),
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  getConnectedAgents: () => ipcRenderer.invoke('get-connected-agents'),

  disconnectAgent: (id) => ipcRenderer.invoke('disconnect-agent', id),
  acceptAgent: (id) => ipcRenderer.invoke('accept-agent', id),
  sendMessageToAgent: (id, msg) => ipcRenderer.invoke('send-message', id, msg),
  discoverAgents: () => ipcRenderer.invoke('discover-agents'),
  inviteAgent: (ip, port) => ipcRenderer.invoke('invite-agent', ip, port),

  // === AGENT ===
  discoverMasters: () => ipcRenderer.invoke('discover-masters'),
  connectToMaster: (info) => ipcRenderer.invoke('connect-to-master', info),
  disconnectFromMaster: () => ipcRenderer.invoke('disconnect-from-master'),

  // === MOONLIGHT / GAMESTREAM (NATIVE SENAISTREAM) ===
  checkSunshine: () => ipcRenderer.invoke('check-sunshine'),
  startGameStream: () => ipcRenderer.invoke('start-gamestream'),
  stopGameStream: () => ipcRenderer.invoke('stop-gamestream'),
  getGameStreamStatus: () => ipcRenderer.invoke('get-gamestream-status'),
  pairMoonlightPin: (pin) => ipcRenderer.invoke('pair-moonlight-pin', pin),

  // === EXTENDED VIRTUAL DISPLAY & HOST CONTROLS ===
  getVirtualDisplayStatus: () => ipcRenderer.invoke('get-virtual-display-status'),
  installVirtualDisplayDriver: () => ipcRenderer.invoke('install-virtual-display-driver'),
  setDisplayMode: (mode) => ipcRenderer.invoke('set-display-mode', mode),
  getHostDisplays: () => ipcRenderer.invoke('get-host-displays'),
  getHostSettings: () => ipcRenderer.invoke('get-host-settings'),
  setHostSettings: (settings) => ipcRenderer.invoke('set-host-settings', settings),

  // === MOONLIGHT — ADVANCED ===
  getMoonlightScreens: () => ipcRenderer.invoke('get-moonlight-screens'),
  setMoonlightScreen: (sourceId) => ipcRenderer.invoke('set-moonlight-screen', sourceId),
  getMoonlightClients: () => ipcRenderer.invoke('get-moonlight-clients'),
  getSunshineStreamStats: () => ipcRenderer.invoke('get-sunshine-stream-stats'),
  getSunshineConfig: () => ipcRenderer.invoke('get-sunshine-config'),
  setSunshineConfig: (config) => ipcRenderer.invoke('set-sunshine-config', config),
  removeMoonlightClient: (uuid) => ipcRenderer.invoke('remove-moonlight-client', uuid),
  discoverSmartTVs: () => ipcRenderer.invoke('discover-smart-tvs'),

  // === SHARED ===
  getInstallMode: () => ipcRenderer.invoke('get-install-mode'),
  setInstallMode: (mode) => ipcRenderer.invoke('set-install-mode', mode),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  toggleFullscreen: (state) => ipcRenderer.send('toggle-fullscreen', state),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  // === AUTO-UPDATE ===
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadAndInstallUpdate: (downloadUrl: string) => ipcRenderer.invoke('updater:download-and-install', downloadUrl),
  onUpdateProgress: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, p: unknown) => cb(p as any);
    ipcRenderer.on('updater:progress', handler);
    return () => ipcRenderer.removeListener('updater:progress', handler);
  },

  // === EVENTS ===
  onScreensChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('screens-changed', handler);
    return () => ipcRenderer.removeListener('screens-changed', handler);
  },
  onAgentConnected: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, agent: unknown) => cb(agent as any);
    ipcRenderer.on('agent-connected', handler);
    return () => ipcRenderer.removeListener('agent-connected', handler);
  },
  onAgentDisconnected: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, id: string) => cb(id);
    ipcRenderer.on('agent-disconnected', handler);
    return () => ipcRenderer.removeListener('agent-disconnected', handler);
  },
  onStreamStats: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, stats: unknown) => cb(stats as any);
    ipcRenderer.on('stream-stats', handler);
    return () => ipcRenderer.removeListener('stream-stats', handler);
  },
  onConnectionError: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, err: string) => cb(err);
    ipcRenderer.on('connection-error', handler);
    return () => ipcRenderer.removeListener('connection-error', handler);
  },
  onMasterDiscovered: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, master: unknown) => cb(master as any);
    ipcRenderer.on('master-discovered', handler);
    return () => ipcRenderer.removeListener('master-discovered', handler);
  },
  onSignalingMessage: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, msg: unknown) => cb(msg as any);
    ipcRenderer.on('signaling-message', handler);
    return () => ipcRenderer.removeListener('signaling-message', handler);
  },
  onGameStreamStatus: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, status: unknown) => cb(status as any);
    ipcRenderer.on('gamestream-status-changed', handler);
    return () => ipcRenderer.removeListener('gamestream-status-changed', handler);
  },
  onAgentDiscovered: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, agent: unknown) => cb(agent as any);
    ipcRenderer.on('agent-discovered', handler);
    return () => ipcRenderer.removeListener('agent-discovered', handler);
  },
  onForceConnectToMaster: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, master: unknown) => cb(master as any);
    ipcRenderer.on('force-connect-to-master', handler);
    return () => ipcRenderer.removeListener('force-connect-to-master', handler);
  },
  onMoonlightStreamStats: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, stats: unknown) => cb(stats as any);
    ipcRenderer.on('moonlight-stream-stats', handler);
    return () => ipcRenderer.removeListener('moonlight-stream-stats', handler);
  },
  onSmartTVsUpdated: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, tvs: unknown) => cb(tvs as any);
    ipcRenderer.on('smart-tvs-updated', handler);
    return () => ipcRenderer.removeListener('smart-tvs-updated', handler);
  },
  onMoonlightPairingRequested: (cb) => {
    const handler = (_: Electron.IpcRendererEvent, info: unknown) => cb(info as any);
    ipcRenderer.on('moonlight-pairing-requested', handler);
    return () => ipcRenderer.removeListener('moonlight-pairing-requested', handler);
  },
};

contextBridge.exposeInMainWorld('screenflow', api);
