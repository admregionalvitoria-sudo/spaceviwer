// ============================================================
// ScreenFlow — Shared Constants
// ============================================================

import type { AppSettings, StreamConfig } from './types';

export const APP_NAME = 'SpaceViewer';
export const APP_VERSION = '2.2.2';
export const DEFAULT_PORT = 7523;

// Moonlight / GameStream protocol
export const GAMESTREAM_PORT = 47989;
export const SUNSHINE_PORT = 47990;
export const SUNSHINE_API_PORT = 47990;
export const GAMESTREAM_MDNS_TYPE = 'nvstream';
export const GAMESTREAM_UNIQUE_ID = 'spaceviewer-host-001';
export const SIGNALING_PATH = '/signaling';
export const DEFAULT_AGENT_PORT = 7524;
export const MDNS_AGENT_TYPE = 'spaceviewer-agt';

export const SUPPORTED_CODECS = ['H264', 'VP8', 'VP9'] as const;
export const SUPPORTED_FPS = [30, 60, 120] as const;
export const SUPPORTED_RESOLUTIONS = [
  { label: '720p', width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
  { label: '1440p', width: 2560, height: 1440 },
  { label: 'Auto', width: 0, height: 0 },
] as const;

export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  sourceId: '',
  captureMode: 'fullscreen',
  resolution: 'auto',
  fps: 30,
  bitrate: 5000,
  codec: 'H264',
  colorDepth: 'YUV420',
  compression: 50,
  audioEnabled: true,
  audioSource: 'system',
  audioBitrate: 192,
  transmissionMode: 'mirror',
  protocol: 'webrtc',
  hardwareEncoding: false,
  targetAgents: [],
};

export const DEFAULT_SETTINGS: AppSettings = {
  server: {
    port: DEFAULT_PORT,
    networkInterface: 'auto',
    enableMdns: true,
    enableMiracast: false,
    password: undefined,
    allowedIps: undefined,
  },
  stream: {
    defaultCodec: 'H264',
    defaultFps: 30,
    defaultBitrate: 5000,
    hardwareEncoding: false,
  },
  audio: {
    defaultSource: 'system',
    playOnAgentOnly: true,
    syncOffset: 0,
    defaultVolume: 100,
  },
  startup: {
    launchWithWindows: false,
    minimizeToTray: true,
    autoStartStream: false,
    showNotifications: true,
  },
  ui: {
    theme: 'dark',
    language: 'pt-BR',
    compactMode: false,
  },
};

export const MDNS_SERVICE_TYPE = 'spaceviewer';
export const MDNS_SERVICE_PROTOCOL = 'tcp';
export const MDNS_MOONLIGHT_TYPE = 'nvstream'; // Moonlight listens for _nvstream._tcp

export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
];

export const PING_INTERVAL = 5000; // ms
export const STATS_INTERVAL = 1000; // ms
export const RECONNECT_DELAY = 3000; // ms
export const MAX_RECONNECT_ATTEMPTS = 5;

export const CONFIG_FILE_NAME = 'install-mode.json';
export const SETTINGS_FILE_NAME = 'settings.json';

// Sunshine REST API base (port 47990, HTTPS, Basic auth)
// Credentials: spaceviewer:spaceviewer → base64: c3BhY2V2aWV3ZXI6c3BhY2V2aWV3ZXI=
export const SUNSHINE_AUTH_B64 = 'c3BhY2V2aWV3ZXI6c3BhY2V2aWV3ZXI=';
export const SUNSHINE_API_BASE = 'https://localhost:47990/api';

// Moonlight integration polling
export const MOONLIGHT_STATS_POLL_INTERVAL = 2000; // ms
export const MOONLIGHT_CLIENTS_POLL_INTERVAL = 5000; // ms

// Sunshine configuration file name (inside Sunshine's app data folder)
export const SUNSHINE_CONF_FILENAME = 'sunshine.conf';


