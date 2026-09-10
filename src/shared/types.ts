// SpaceViewer v2.2.9
// ============================================================
// ScreenFlow — Shared Type Definitions
// ============================================================

export type InstallMode = 'master' | 'agent' | 'both';
export type StreamStatus = 'idle' | 'starting' | 'streaming' | 'paused' | 'error';
export type AgentStatus = 'connected' | 'streaming' | 'paused' | 'disconnected' | 'pending';
export type TransmissionMode = 'mirror' | 'extend' | 'cast';
export type VideoCodec = 'H264' | 'H265' | 'VP8' | 'VP9' | 'AV1';
export type AudioSource = 'system' | 'microphone' | 'both';
export type Protocol = 'webrtc' | 'miracast' | 'auto';
export type SunshineStatus = 'not_installed' | 'stopped' | 'running' | 'checking';
export type GameStreamStatus = 'stopped' | 'running' | 'error';

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

// ============================================================
// Moonlight / GameStream (SpaceviwerStream) Integration Types
// ============================================================

export type DisplayTopologyMode = 'extended' | 'duplicate';

export interface HostDisplayInfo {
  index: number;
  name: string;
  deviceName: string;
  width: number;
  height: number;
  primary: boolean;
  virtual: boolean;
}

export interface HostSettings {
  display: number;
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
  hardware: boolean;
  virtualDisplay: boolean;
}

export interface VirtualDisplayStatus {
  installed: boolean;
  active: boolean;
  enabled?: boolean;
  count?: number;
}

export interface VirtualDisplayState {
  installed: boolean;
  active: boolean;
  enabled: boolean;
  count: number;
}

/** A Moonlight client that has been paired with this host */
export interface MoonlightClient {
  uuid: string;
  name: string;
  enabled: boolean;
}

/** Real-time streaming metrics polled from GameStream host */
export interface SunshineStreamStats {
  isStreaming: boolean;
  fps: number;
  bitrate: number; // kbps
  resolution: { width: number; height: number };
  activeClients: number;
  encoder: string; // e.g. 'NVENC', 'AMF', 'QuickSync', 'Software'
  uptime: number; // seconds streaming
  displayMode?: DisplayTopologyMode;
}

/** Configuration that SpaceViewer manages */
export interface SunshineConfig {
  displayName: string;
  captureDisplayIndex: number;
  selectedSourceId: string | null;
  fps: number;
  resolution: { width: number; height: number };
}

/** Discovered Smart TV or Moonlight device on the local network */
export interface SmartTVDevice {
  id: string;
  name: string;
  ip: string;
  brand: 'lg' | 'samsung' | 'androidtv' | 'appletv' | 'roku' | 'firetv' | 'moonlight' | 'generic';
  model?: string;
  status: 'online' | 'streaming' | 'paired';
  isMoonlightPaired: boolean;
  clientUuid?: string;
  type: 'tv' | 'streaming_box' | 'moonlight_app' | 'console';
  lastSeen: number;
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
  isMoonlightTarget: boolean;
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

  // Moonlight / GameStream (Native SpaceviwerStream Host)
  checkSunshine: () => Promise<SunshineStatus>;
  startGameStream: () => Promise<boolean>;
  stopGameStream: () => Promise<void>;
  getGameStreamStatus: () => Promise<GameStreamStatus>;
  getHostInfo: () => Promise<{ hostname: string; rawHostname: string; ip: string }>;
  pairMoonlightPin: (pin: string) => Promise<{ success: boolean; error?: string }>;

  // Extended Virtual Display & Native Host Controls
  getVirtualDisplayStatus: () => Promise<VirtualDisplayStatus>;
  getVirtualDisplayState: () => Promise<VirtualDisplayState>;
  setVirtualDisplayCount: (count: number) => Promise<{ success: boolean; count?: number; error?: string }>;
  addVirtualDisplay: () => Promise<{ success: boolean; count: number; error?: string }>;
  removeVirtualDisplay: () => Promise<{ success: boolean; count: number; error?: string }>;
  toggleVirtualDisplays: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  installVirtualDisplayDriver: () => Promise<{ success: boolean; error?: string; rebootRequired?: boolean }>;
  setDisplayMode: (mode: DisplayTopologyMode) => Promise<{ success: boolean; error?: string }>;
  getHostDisplays: () => Promise<HostDisplayInfo[]>;
  getNativeSessions: () => Promise<{ address: string; display: number }[]>;
  setNativeSessionDisplay: (address: string, display: number) => Promise<{ success: boolean; error?: string }>;
  getHostSettings: () => Promise<HostSettings>;
  setHostSettings: (settings: Partial<HostSettings>) => Promise<{ success: boolean; error?: string }>;

  // Screens & Clients
  getMoonlightScreens: () => Promise<ScreenSource[]>;
  setMoonlightScreen: (sourceId: string) => Promise<{ success: boolean; error?: string }>;
  getMoonlightClients: () => Promise<MoonlightClient[]>;
  getSunshineStreamStats: () => Promise<SunshineStreamStats>;
  getSunshineConfig: () => Promise<SunshineConfig>;
  setSunshineConfig: (config: Partial<SunshineConfig>) => Promise<{ success: boolean; error?: string }>;
  removeMoonlightClient: (uuid: string) => Promise<{ success: boolean; error?: string }>;
  discoverSmartTVs: () => Promise<SmartTVDevice[]>;

  // Shared
  getInstallMode: () => Promise<InstallMode>;
  setInstallMode: (mode: InstallMode) => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  getSettings: () => Promise<AppSettings>;
  toggleFullscreen: (state: boolean) => void;
  getAppVersion: () => Promise<string>;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;

  // Auto-Update
  checkForUpdates: () => Promise<UpdateInfo>;
  downloadAndInstallUpdate: (downloadUrl: string) => Promise<{ success: boolean; error?: string }>;
  applyUpdateAndRestart: () => Promise<{ success: boolean; error?: string }>;
  onUpdateProgress: (cb: (progress: UpdateProgress) => void) => () => void;

  // Events
  onScreensChanged: (cb: () => void) => () => void;
  onAgentConnected: (cb: (agent: Agent) => void) => () => void;
  onAgentDisconnected: (cb: (id: string) => void) => () => void;
  onStreamStats: (cb: (stats: StreamStats) => void) => () => void;
  onConnectionError: (cb: (err: string) => void) => () => void;
  onMasterDiscovered: (cb: (master: MasterInfo) => void) => () => void;
  onSignalingMessage: (cb: (msg: SignalingMessage) => void) => () => void;
  onGameStreamStatus: (cb: (status: GameStreamStatus) => void) => () => void;
  onAgentDiscovered: (cb: (agent: any) => void) => () => void;
  onForceConnectToMaster: (cb: (master: MasterInfo) => void) => () => void;
  onMoonlightStreamStats: (cb: (stats: SunshineStreamStats) => void) => () => void;
  onSmartTVsUpdated: (cb: (tvs: SmartTVDevice[]) => void) => () => void;
  onMoonlightPairingRequested: (cb: (info: { name?: string; message?: string }) => void) => () => void;
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


