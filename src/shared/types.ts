// SpaceViewer v3.1.0
// ============================================================
// SpaceViewer — Shared Type Definitions
// ============================================================

export type InstallMode = 'master' | 'agent' | 'both';
export type StreamStatus = 'idle' | 'starting' | 'streaming' | 'paused' | 'error';
export type AgentStatus = 'connected' | 'streaming' | 'paused' | 'disconnected' | 'pending';
export type TransmissionMode = 'mirror' | 'extend' | 'cast';
export type VideoCodec = 'H264' | 'H265' | 'VP8' | 'VP9' | 'AV1';
export type AudioSource = 'system' | 'microphone' | 'both';
export type Protocol = 'webrtc' | 'miracast' | 'auto';

export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  displayId: string;
}

export interface Agent {
  id: string;
  name: string;
  ip: string;
  port: number;
  os: 'windows' | 'linux' | 'macos' | 'android' | 'ios';
  osVersion: string;
  resolution: { width: number; height: number };
  status: AgentStatus;
  mode: TransmissionMode;
  connectedAt: number;
  metrics: AgentMetrics;
  capabilities: AgentCapabilities;
  audioPlaying: boolean;
}

export interface AgentMetrics {
  latency: number;
  fps: number;
  bandwidth: number;
  packetsLost: number;
  jitter: number;
  decodingTime: number;
}

export interface AgentCapabilities {
  maxResolution: { width: number; height: number };
  supportedCodecs: VideoCodec[];
  hardwareDecoding: boolean;
  audioOutput: boolean;
  miracast: boolean;
}

export interface StreamConfig {
  sourceId: string;
  captureMode: 'fullscreen' | 'window' | 'region';
  resolution: { width: number; height: number } | 'auto';
  fps: 30 | 60 | 120;
  bitrate: number;
  codec: VideoCodec;
  colorDepth: 'YUV420' | 'YUV422' | 'YUV444';
  compression: number;
  audioEnabled: boolean;
  audioSource: AudioSource;
  audioBitrate: 128 | 192 | 320;
  transmissionMode: TransmissionMode;
  protocol: Protocol;
  hardwareEncoding: boolean;
  targetAgents: string[];
}

export interface StreamStats {
  totalBandwidth: number;
  avgLatency: number;
  avgFps: number;
  activeAgents: number;
  encodingFps: number;
  cpuUsage: number;
  gpuUsage: number;
  uptime: number;
}

export interface MasterInfo {
  name: string;
  host: string;
  addresses: string[];
  port: number;
  version?: string;
  os?: string;
  capabilities?: string[];
  offline?: boolean;
}

export interface AppSettings {
  server: {
    port: number;
    networkInterface: string;
    enableMdns: boolean;
    enableMiracast: boolean;
    password?: string;
    allowedIps?: string[];
  };
  stream: {
    defaultCodec: VideoCodec;
    defaultFps: number;
    defaultBitrate: number;
    hardwareEncoding: boolean;
  };
  audio: {
    defaultSource: AudioSource;
    playOnAgentOnly: boolean;
    syncOffset: number;
    defaultVolume: number;
  };
  startup: {
    launchWithWindows: boolean;
    minimizeToTray: boolean;
    autoStartStream: boolean;
    showNotifications: boolean;
  };
  ui: {
    theme: 'dark' | 'light' | 'system';
    language: 'pt-BR' | 'en' | 'es';
    compactMode: boolean;
  };
  display: DisplaySettings;
}

// ============================================================
// Extended / mirrored displays on Android receivers
// (contract: docs/ARQUITETURA-TELA-ESTENDIDA.md)
// ============================================================

export type ReceiverMode = 'extend' | 'mirror';
export type QualityPreset = 'economy' | 'balanced' | 'high' | 'ultra' | 'native' | 'custom';
export type QualityPriority = 'sharpness' | 'balanced' | 'smoothness';
export type ReceiverOrientation = 'landscape' | 'portrait' | 'auto';
export type DisplayCodec = 'H264' | 'VP9' | 'VP8';
export type DisplayTransport = 'native' | 'webrtc';

export interface DisplayQuality {
  preset: QualityPreset;
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  codec: DisplayCodec;
  priority: QualityPriority;
  orientation: ReceiverOrientation;
}

export interface DisplaySettings {
  transport: DisplayTransport;
  quality: DisplayQuality;
  audio: { enabled: boolean; bitrateKbps: 96 | 128 | 192 | 256 };
  totalBitrateKbps: number;
  keepVirtualDisplays: boolean;
  autoReconnect: boolean;
}

/** DeviceInfo JSON published by the APK (UDP 47810/47812 and GET /info). */
export interface DeviceInfo {
  type: 'spaceviewer-display';
  protocol: number;
  id: string;
  name: string;
  model: string;
  manufacturer: string;
  android: string;
  appVersion: string;
  ip: string;
  ips?: string[];
  controlPort: number;
  streamPort?: number;
  capabilities?: string[];
  width: number;
  height: number;
  refreshRate: number;
  density: number;
  orientation: ReceiverOrientation;
  state: 'idle' | 'connecting' | 'streaming';
  connectedTo: string | null;
}

export interface ReceiverAssignment {
  mode: ReceiverMode;
  /** Electron display id to mirror (mode "mirror"). Empty = primary display. */
  sourceDisplayId?: string;
  /** Per-device quality override; falls back to AppSettings.display.quality. */
  quality?: DisplayQuality | null;
  /** Per-device audio override; null/undefined falls back to AppSettings.display.audio. */
  audio?: boolean | null;
  autoConnect: boolean;
}

export type ReceiverSessionStatus = 'preparing' | 'connecting' | 'streaming' | 'error';

export interface ReceiverSession {
  sessionId: string;
  agentId?: string;
  mode: ReceiverMode;
  transport?: DisplayTransport;
  encoder?: string;
  decoder?: string;
  /** Electron display id being captured for this receiver. */
  displayId?: string;
  /** Windows device name of the reserved virtual display (mode "extend"). */
  virtualDeviceName?: string;
  label: string;
  status: ReceiverSessionStatus;
  error?: string;
  quality: DisplayQuality;
  audio: boolean;
}

export interface ReceiverStats {
  fps: number;
  mbps: number;
  rttMs: number;
  width: number;
  height: number;
  packetsLost: number;
  jitterMs: number;
  bufferMs?: number;
  queueMs?: number;
  bitrateKbps?: number;
}

export interface DisplayReceiver extends DeviceInfo {
  lastSeen: number;
  online: boolean;
  source: 'udp' | 'mdns' | 'manual';
  assignment: ReceiverAssignment;
  session?: ReceiverSession | null;
  stats?: ReceiverStats | null;
}

export interface PcDisplay {
  /** Electron display id. */
  id: string;
  /** Windows device name, e.g. \\.\DISPLAY3 (empty when unknown). */
  deviceName: string;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  /** Physical pixels. */
  width: number;
  height: number;
  refreshRate: number;
  scaleFactor: number;
  primary: boolean;
  virtual: boolean;
  /** desktopCapturer source id (screen:...). */
  sourceId: string;
  thumbnail: string;
  assignedReceiverIds: string[];
}

export interface VirtualDriverState {
  installed: boolean;
  enabled: boolean;
  count: number;
  outputs: number;
  /** Remote Desktop session: Windows only shows the remote adapter, extended monitors cannot appear. */
  remoteSession: boolean;
}

export type DisplayActionResult = { success: boolean; error?: string };

/** Sent by main when a receiver's WebSocket is accepted and the renderer must start streaming. */
export interface DisplaySessionReady {
  receiverId: string;
  agentId: string;
  sessionId: string;
  displayId: string;
  sourceId: string;
  label: string;
  mode: ReceiverMode;
  quality: DisplayQuality;
  audio: { enabled: boolean; bitrateKbps: number };
}

export interface SignalingMessage {
  type:
    | 'webrtc-offer'
    | 'webrtc-answer'
    | 'ice-candidate'
    | 'agent-info'
    | 'stream-config'
    | 'ping'
    | 'pong'
    | 'auth'
    | 'auth-response'
    | 'stream-start'
    | 'stream-stop'
    | 'get-screens'
    | 'screens-list'
    | 'request-stream';
  fromId?: string;
  targetId?: string;
  payload: unknown;
}

export interface AgentConnection {
  id: string;
  ws: unknown; // WebSocket instance
  ip: string;
  connectedAt: number;
  name?: string;
  os?: string;
  authenticated?: boolean;
}

export interface CaptureConfig {
  sourceId: string;
  fps: number;
  width: number;
  height: number;
  audioEnabled: boolean;
}

export type DisplayTopologyMode = 'extend' | 'duplicate';

export interface VirtualDisplayState {
  installed: boolean;
  active: boolean;
  enabled: boolean;
  count: number;
  outputs: number;
}

// Screens & Application Projector Types
export interface DetailedScreenInfo {
  id: string;
  displayId: string;
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
  isVirtual: boolean;
  thumbnail: string;
  projectedApp?: {
    sourceId: string;
    appName: string;
  } | null;
}

export interface AppWindowSource {
  id: string;
  name: string;
  appName?: string;
  appIcon?: string | null;
  thumbnail: string;
}

export interface ProjectorState {
  [displayId: string]: {
    sourceId: string;
    appName: string;
  };
}

// IPC API type for the renderer
export interface ScreenFlowAPI {
  // Screens & Application Projector
  getScreensDetailed: () => Promise<DetailedScreenInfo[]>;
  getAppWindows: () => Promise<AppWindowSource[]>;
  startAppProjector: (sourceId: string, appName: string, displayId: string) => Promise<{ success: boolean; error?: string }>;
  startObsProjector: (sourceId: string, appName: string, displayId: string) => Promise<{ success: boolean; error?: string }>;
  stopAppProjector: (displayId?: string) => Promise<{ success: boolean }>;
  stopObsProjector: (displayId?: string) => Promise<{ success: boolean }>;
  getProjectorParams: () => Promise<{ sourceId: string; appName: string; displayId?: string } | null>;
  getActiveProjectors: () => Promise<ProjectorState>;
  moveWindowToScreen: (windowName: string, displayId: string, sourceId?: string) => Promise<{ success: boolean; error?: string }>;

  // Master
  getScreens: () => Promise<ScreenSource[]>;
  startCapture: (config: CaptureConfig) => Promise<boolean>;
  stopCapture: () => Promise<void>;
  pauseCapture: () => Promise<void>;
  getNetworkAddresses: () => Promise<string[]>;
  getServerStatus: () => Promise<string>;
  getConnectedAgents: () => Promise<Agent[]>;
  disconnectAgent: (id: string) => Promise<void>;
  acceptAgent: (id: string) => Promise<void>;
  sendMessageToAgent: (id: string, msg: string) => Promise<void>;
  discoverAgents: () => Promise<void>;
  inviteAgent: (ip: string, port: number) => Promise<{ success: boolean; error?: string }>;

  // Agent
  discoverMasters: () => Promise<MasterInfo[]>;
  connectToMaster: (info: MasterInfo) => Promise<boolean>;
  disconnectFromMaster: () => Promise<void>;

  // PC displays (topology & virtual displays)
  listPcDisplays: () => Promise<PcDisplay[]>;
  getVirtualDriverState: () => Promise<VirtualDriverState>;
  installVirtualDriver: () => Promise<DisplayActionResult>;

  setDisplayResolution: (deviceName: string, width: number, height: number, refreshRate: number) => Promise<DisplayActionResult>;
  setDisplayPosition: (deviceName: string, x: number, y: number) => Promise<DisplayActionResult>;
  setPrimaryDisplay: (deviceName: string) => Promise<DisplayActionResult>;
  ensureVirtualCursor: () => Promise<{ success: boolean; error?: string }>;
  restoreNormalCursor: () => Promise<{ success: boolean; error?: string }>;
  getHostInfo: () => Promise<{ hostname: string; rawHostname: string; ip: string; apkUrl: string | null }>;

  // Android receivers (SpaceViewer Display APK)
  listReceivers: () => Promise<DisplayReceiver[]>;
  scanReceivers: () => Promise<DisplayReceiver[]>;
  addReceiverByIp: (ip: string) => Promise<{ success: boolean; error?: string }>;
  setReceiverAssignment: (id: string, assignment: Partial<ReceiverAssignment>) => Promise<DisplayActionResult>;
  connectReceiver: (id: string) => Promise<DisplayActionResult>;
  disconnectReceiver: (id: string) => Promise<DisplayActionResult>;
  applyReceiversMode: (ids: string[], mode: ReceiverMode, sourceDisplayId?: string) => Promise<DisplayActionResult>;
  disconnectAllReceivers: () => Promise<DisplayActionResult>;
  reportReceiverStatus: (receiverId: string, status: 'streaming' | 'error', error?: string) => void;
  reportReceiverNotice: (receiverId: string, message: string) => void;

  // Native audio
  sendNativeAudio: (chunk: ArrayBuffer) => void;
  onNativeAudioState: (cb: (state: { enabled: boolean }) => void) => () => void;

  // Shared
  getInstallMode: () => Promise<InstallMode>;
  setInstallMode: (mode: InstallMode) => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  getSettings: () => Promise<AppSettings>;
  toggleFullscreen: (state: boolean) => void;
  getAppVersion: () => Promise<string>;
  openDiagnosticsFolder: () => Promise<{ success: boolean; error?: string }>;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;

  // Auto-Update
  checkForUpdates: () => Promise<UpdateInfo>;
  downloadAndInstallUpdate: (downloadUrl: string) => Promise<{ success: boolean; error?: string }>;
  applyUpdateAndRestart: () => Promise<{ success: boolean; error?: string }>;
  onUpdateProgress: (cb: (progress: UpdateProgress) => void) => () => void;

  // Events
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => () => void;
  onScreensChanged: (cb: () => void) => () => void;
  onAgentConnected: (cb: (agent: Agent) => void) => () => void;
  onAgentDisconnected: (cb: (id: string) => void) => () => void;
  onStreamStats: (cb: (stats: StreamStats) => void) => () => void;
  onConnectionError: (cb: (err: string) => void) => () => void;
  onMasterDiscovered: (cb: (master: MasterInfo) => void) => () => void;
  onSignalingMessage: (cb: (msg: SignalingMessage) => void) => () => void;
  onAgentDiscovered: (cb: (agent: any) => void) => () => void;
  onForceConnectToMaster: (cb: (master: MasterInfo) => void) => () => void;
  onReceiversUpdated: (cb: (receivers: DisplayReceiver[]) => void) => () => void;
  onDisplaySessionReady: (cb: (session: DisplaySessionReady) => void) => () => void;
  onDisplaySessionEnded: (cb: (info: { receiverId: string; agentId: string; reconfigure: boolean }) => void) => () => void;
}

export interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  releaseDate: string;
  downloadUrl?: string;
  assetName?: string;
  assetSize?: number;
  htmlUrl?: string;
  error?: string;
}

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  speed: number;
}

declare global {
  interface Window {
    screenflow: ScreenFlowAPI;
  }
}
