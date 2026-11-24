// SpaceViewer v3.1.0
// ============================================================
// SpaceViewer — Preload Script (contextBridge)
// ============================================================

import { contextBridge, ipcRenderer } from 'electron';
import type { ScreenFlowAPI } from '../shared/types';

/** Subscribes to a main-process event and returns the unsubscribe function. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_: Electron.IpcRendererEvent, payload: unknown) => cb(payload as T);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

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

  // === PC DISPLAYS ===
  listPcDisplays: () => ipcRenderer.invoke('list-pc-displays'),
  getVirtualDriverState: () => ipcRenderer.invoke('get-virtual-driver-state'),
  installVirtualDriver: () => ipcRenderer.invoke('install-virtual-driver'),

  setDisplayResolution: (deviceName, width, height, refreshRate) =>
    ipcRenderer.invoke('set-display-resolution', deviceName, width, height, refreshRate),
  setDisplayPosition: (deviceName, x, y) => ipcRenderer.invoke('set-display-position', deviceName, x, y),
  setPrimaryDisplay: (deviceName) => ipcRenderer.invoke('set-primary-display', deviceName),
  ensureVirtualCursor: () => ipcRenderer.invoke('ensure-virtual-cursor'),
  restoreNormalCursor: () => ipcRenderer.invoke('restore-normal-cursor'),
  getHostInfo: () => ipcRenderer.invoke('get-host-info'),

  // === ANDROID RECEIVERS ===
  listReceivers: () => ipcRenderer.invoke('list-receivers'),
  scanReceivers: () => ipcRenderer.invoke('scan-receivers'),
  addReceiverByIp: (ip) => ipcRenderer.invoke('add-receiver-by-ip', ip),
  setReceiverAssignment: (id, assignment) => ipcRenderer.invoke('set-receiver-assignment', id, assignment),
  connectReceiver: (id) => ipcRenderer.invoke('connect-receiver', id),
  disconnectReceiver: (id) => ipcRenderer.invoke('disconnect-receiver', id),
  applyReceiversMode: (ids, mode, sourceDisplayId) => ipcRenderer.invoke('apply-receivers-mode', ids, mode, sourceDisplayId),
  disconnectAllReceivers: () => ipcRenderer.invoke('disconnect-all-receivers'),
  reportReceiverStatus: (receiverId, status, error) => ipcRenderer.send('report-receiver-status', receiverId, status, error),
  reportReceiverNotice: (receiverId, message) => ipcRenderer.send('report-receiver-notice', receiverId, message),

  // === NATIVE AUDIO ===
  sendNativeAudio: (chunk: ArrayBuffer) => ipcRenderer.send('native-audio-chunk', chunk),
  onNativeAudioState: (cb) => on('native-audio-state', cb),

  // === SHARED ===
  getInstallMode: () => ipcRenderer.invoke('get-install-mode'),
  setInstallMode: (mode) => ipcRenderer.invoke('set-install-mode', mode),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  toggleFullscreen: (state) => ipcRenderer.send('toggle-fullscreen', state),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openDiagnosticsFolder: () => ipcRenderer.invoke('open-diagnostics-folder'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // === AUTO-UPDATE ===
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadAndInstallUpdate: (downloadUrl: string) => ipcRenderer.invoke('updater:download-and-install', downloadUrl),
  applyUpdateAndRestart: () => ipcRenderer.invoke('updater:apply-and-restart'),
  onUpdateProgress: (cb) => on('updater:progress', cb),

  // === EVENTS ===
  onUpdateAvailable: (cb) => on('updater:available-auto', cb),
  onScreensChanged: (cb) => on('screens-changed', () => cb()),
  onAgentConnected: (cb) => on('agent-connected', cb),
  onAgentDisconnected: (cb) => on('agent-disconnected', cb),
  onStreamStats: (cb) => on('stream-stats', cb),
  onConnectionError: (cb) => on('connection-error', cb),
  onMasterDiscovered: (cb) => on('master-discovered', cb),
  onSignalingMessage: (cb) => on('signaling-message', cb),
  onAgentDiscovered: (cb) => on('agent-discovered', cb),
  onForceConnectToMaster: (cb) => on('force-connect-to-master', cb),
  onReceiversUpdated: (cb) => on('display-receivers-updated', cb),
  onDisplaySessionReady: (cb) => on('display-session-ready', cb),
  onDisplaySessionEnded: (cb) => on('display-session-ended', cb),
};

contextBridge.exposeInMainWorld('screenflow', api);
