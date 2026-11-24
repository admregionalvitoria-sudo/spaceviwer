// SpaceViewer v3.1.0
// ============================================================
// ScreenFlow — Shared Constants
// ============================================================

import type { AppSettings, DisplayQuality, QualityPreset, StreamConfig } from './types';

export const APP_NAME = 'SpaceViewer';
export const APP_VERSION = '3.2.1';
export const DEFAULT_PORT = 7523;

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
  display: {
    transport: 'webrtc',
    totalBitrateKbps: 20000,
    quality: {
      preset: 'balanced',
      width: 1920,
      height: 1080,
      fps: 60,
      bitrateKbps: 12000,
      codec: 'H264',
      priority: 'smoothness',
      orientation: 'landscape',
    },
    audio: {
      enabled: true,
      bitrateKbps: 192,
    },
    keepVirtualDisplays: false,
    autoReconnect: true,
  },
};

export const MDNS_SERVICE_TYPE = 'spaceviewer';
export const MDNS_SERVICE_PROTOCOL = 'tcp';

export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
];

export const PING_INTERVAL = 5000; // ms
export const STATS_INTERVAL = 1000; // ms
export const RECONNECT_DELAY = 3000; // ms
export const MAX_RECONNECT_ATTEMPTS = 5;

export const CONFIG_FILE_NAME = 'install-mode.json';
export const SETTINGS_FILE_NAME = 'settings.json';

// ============================================================
// Android receivers (docs/ARQUITETURA-TELA-ESTENDIDA.md §3)
// ============================================================
export const RECEIVER_DISCOVERY_PORT = 47810;
export const RECEIVER_CONTROL_PORT = 47811;
export const RECEIVER_ANNOUNCE_PORT = 47812;
export const RECEIVER_STREAM_PORT = 47813;
export const RECEIVER_DISCOVERY_PROBE = 'SPACEVIEWER_DISCOVER_V1';
export const RECEIVER_MDNS_TYPE = 'svdisplay';
export const RECEIVER_EXPIRY_MS = 10000;
export const MAX_VIRTUAL_DISPLAYS = 4;
export const APK_FILE_NAME = 'SpaceViewerDisplay.apk';

export const QUALITY_PRESETS: Record<Exclude<QualityPreset, 'native' | 'custom'>, Pick<DisplayQuality, 'width' | 'height' | 'fps' | 'bitrateKbps'> & { label: string }> = {
  economy: { label: 'Economia (720p)', width: 1280, height: 720, fps: 60, bitrateKbps: 5000 },
  balanced: { label: 'Equilibrado (1080p)', width: 1920, height: 1080, fps: 60, bitrateKbps: 12000 },
  high: { label: 'Alta (1440p)', width: 2560, height: 1440, fps: 60, bitrateKbps: 25000 },
  ultra: { label: 'Ultra (4K)', width: 3840, height: 2160, fps: 60, bitrateKbps: 50000 },
};

/** Frame rates offered for every preset (presets define size and bitrate; fps is chosen apart). */
export const PRESET_FPS_OPTIONS = [30, 60] as const;

/** Preset bitrates are tuned for 60 fps; at 30 fps each frame keeps most of its bits. */
function bitrateForFps(bitrateAt60: number, fps: number): number {
  return fps >= 60 ? bitrateAt60 : Math.round(bitrateAt60 * (0.35 + 0.65 * (fps / 60)));
}

export const QUALITY_PRESET_LABELS: Record<QualityPreset, string> = {
  economy: QUALITY_PRESETS.economy.label,
  balanced: QUALITY_PRESETS.balanced.label,
  high: QUALITY_PRESETS.high.label,
  ultra: QUALITY_PRESETS.ultra.label,
  native: 'Nativa do aparelho',
  custom: 'Personalizada',
};

export const SUPPORTED_DISPLAY_FPS = [30, 60, 90, 120] as const;
export const MIN_BITRATE_KBPS = 2000;
export const MAX_BITRATE_KBPS = 80000;

/**
 * Resolves the effective quality for a receiver: presets fill in size/fps/bitrate,
 * "native" follows the device panel, fps is capped to the device refresh rate.
 */
export function resolveQuality(quality: DisplayQuality, device?: { width: number; height: number; refreshRate: number }): DisplayQuality {
  let { width, height, fps, bitrateKbps } = quality;
  // Presets keep the chosen frame rate (30 or 60); anything else falls back to 60.
  const chosenFps = fps === 30 ? 30 : 60;
  if (quality.preset === 'native' && device) {
    width = device.width;
    height = device.height;
    fps = Math.min(chosenFps, Math.max(30, device.refreshRate || 60));
    bitrateKbps = Math.round((width * height * fps * 0.1) / 1000);
  } else if (quality.preset !== 'custom' && quality.preset !== 'native') {
    const preset = QUALITY_PRESETS[quality.preset];
    width = preset.width;
    height = preset.height;
    fps = chosenFps;
    bitrateKbps = bitrateForFps(preset.bitrateKbps, chosenFps);
  }
  if (device?.refreshRate) fps = Math.min(fps, Math.max(30, device.refreshRate));
  width = Math.max(640, Math.round(width / 2) * 2);
  height = Math.max(360, Math.round(height / 2) * 2);
  bitrateKbps = Math.min(MAX_BITRATE_KBPS, Math.max(MIN_BITRATE_KBPS, Math.round(bitrateKbps)));
  if (quality.orientation === 'portrait' && width > height) [width, height] = [height, width];
  return { ...quality, width, height, fps, bitrateKbps };
}
