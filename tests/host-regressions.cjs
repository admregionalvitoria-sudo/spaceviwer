// Regression tests for the receiver session orchestrator (src/main/display-sessions.ts).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}

function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(transpile(file), {
    module, exports: module.exports, require: (name) => mocks[name] ?? require(name),
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
  });
  return module.exports;
}

const constants = load('src/shared/constants.ts', {});

function fixture(options = {}) {
  const calls = [];
  const physical = { id: '1', deviceName: '\\\\.\\DISPLAY1', label: 'Monitor principal', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, width: 1920, height: 1080, refreshRate: 60, scaleFactor: 1, primary: true, virtual: false, sourceId: 'screen:1:0', thumbnail: '', assignedReceiverIds: [] };
  let attachedDisplay = null;
  const displays = () => [physical, ...(attachedDisplay ? [attachedDisplay] : [])];
  const topology = {
    listPcDisplays: async () => displays(),
    waitForElectronDisplays: async () => displays(),
    attachVirtualDisplay: async (w, h, hz, busyDeviceNames) => {
      calls.push(['attach-virtual-display', w, h, hz, busyDeviceNames]);
      if (options.virtualFailure) return { success: false, error: 'driver refused' };
      const finalW = options.modeRefused?.(w, h) ? 2400 : w;
      const finalH = options.modeRefused?.(w, h) ? 1080 : h;
      attachedDisplay = {
        ...physical,
        id: '100',
        deviceName: '\\\\.\\DISPLAY10',
        label: 'Tela de Galaxy Tab (estendida)',
        primary: false,
        virtual: true,
        width: finalW,
        height: finalH,
        refreshRate: hz,
        bounds: { x: 1920, y: 0, width: finalW, height: finalH },
        sourceId: 'screen:100:0',
      };
      return { success: true, display: attachedDisplay };
    },
    detachVirtualDisplay: async (deviceName) => {
      calls.push(['detach-virtual-display', deviceName]);
      attachedDisplay = null;
      return { success: true };
    },
    attachVirtualOutput: async (device, x, y, w, h, hz) => {
      calls.push(['attach-virtual-output', device, x, y, w, h, hz]);
      return { success: true };
    },
    detachVirtualOutput: async (device) => {
      calls.push(['detach-virtual-output', device]);
      return { success: true };
    },
    detachAllVirtualOutputs: async () => {
      calls.push(['detach-all-virtual-outputs']);
      return { success: true };
    },
    closestVirtualMode: (w, h) => {
      const portrait = h > w;
      const aspect = w / h;
      return [
        [1280, 720], [1280, 800], [1366, 768], [1600, 900], [1920, 1080], [1920, 1200], [2000, 1200], [2048, 1536],
        [2160, 1080], [2340, 1080], [2400, 1080], [2560, 1440], [2560, 1600], [2732, 2048], [2800, 1752], [2880, 1800],
        [3200, 2000], [3840, 2160], [720, 1280], [800, 1280], [1080, 1920], [1200, 1920], [1080, 2400], [1600, 2560],
      ]
        .filter(([cw, ch]) => (ch > cw) === portrait)
        .sort((a, b) => {
          const da = Math.abs(a[0] / a[1] - aspect), db = Math.abs(b[0] / b[1] - aspect);
          if (Math.abs(da - db) > 0.02) return da - db;
          return Math.abs(a[0] * a[1] - w * h) - Math.abs(b[0] * b[1] - w * h);
        })[0] ?? [1920, 1080];
    },
    VIRTUAL_MODES: [
      [1280, 720], [1280, 800], [1366, 768], [1600, 900], [1920, 1080], [1920, 1200], [2000, 1200], [2048, 1536],
      [2160, 1080], [2340, 1080], [2400, 1080], [2560, 1440], [2560, 1600], [2732, 2048], [2800, 1752], [2880, 1800],
      [3200, 2000], [3840, 2160], [720, 1280], [800, 1280], [1080, 1920], [1200, 1920], [1080, 2400], [1600, 2560],
    ],
  };
  const device = {
    id: 'tab-1',
    name: 'Galaxy Tab',
    ip: '192.168.0.42',
    controlPort: 47811,
    width: 2560,
    height: 1600,
    refreshRate: 120,
    state: 'idle',
    type: 'spaceviewer-display',
    capabilities: options.capabilities ?? [],
    streamPort: options.streamPort ?? 47813,
    ...options.device,
  };
  const receivers = Object.assign(new EventEmitter(), {
    pinned: new Set(),
    list: () => [device],
    get: (id) => (id === device.id ? device : undefined),
    isOnline: () => true,
    connect: async (id, request) => { calls.push(['connect', id, request]); },
    disconnect: async (id) => { calls.push(['disconnect', id]); },
  });
  const sent = [];
  const signaling = { isRunning: true, listeningPort: 7523, sendToAgent: (id, msg) => sent.push([id, msg]), disconnectAgentById: (id) => calls.push(['ws-close', id]) };
  let stored = { receiverAssignments: options.assignments ?? {} };
  class Store { constructor() {} get(key) { return JSON.parse(JSON.stringify(stored[key])); } set(key, value) { stored = { ...stored, [key]: value }; } }
  const settings = { ...constants.DEFAULT_SETTINGS, display: { ...constants.DEFAULT_SETTINGS.display, autoReconnect: false, ...(options.display || {}) } };
  const api = load('src/main/display-sessions.ts', {
    'electron-store': { default: Store, __esModule: true },
    './display-topology': topology,
    './display-receivers': {},
    '../shared/constants': constants,
    './native-encoder': options.nativeEncoder ?? { ffmpegPath: () => null, probeEncoders: async () => [] },
    './native-stream': options.nativeStream ?? { NativeStreamSession: class extends EventEmitter { async start() {} async stop() {} } },
    './diagnostics-log': { log() {}, getDiagnosticsDir: () => '' },
  });
  const sessions = new api.DisplaySessions({ settings: () => settings, signaling: () => signaling, receivers });
  const events = [];
  for (const name of ['session-ready', 'session-ended', 'notice']) sessions.on(name, (payload) => events.push([name, payload]));
  return { api, sessions, calls, sent, events, device };
}

test('resolveQuality for preset economy returns 1280x720 @ 60', () => {
  const quality = constants.resolveQuality({
    preset: 'economy',
    width: 0,
    height: 0,
    fps: 0,
    bitrateKbps: 0,
    codec: 'H264',
    priority: 'smoothness',
    orientation: 'landscape',
  });
  assert.equal(quality.width, 1280);
  assert.equal(quality.height, 720);
  assert.equal(quality.fps, 60);
  assert.equal(quality.bitrateKbps, 5000);
});

test('closest virtual mode keeps orientation and aspect ratio', () => {
  const { api } = fixture();
  assert.deepEqual([...api.closestVirtualMode(2560, 1600)], [2560, 1600]);
  assert.deepEqual([...api.closestVirtualMode(2412, 1080)], [2400, 1080]);
  assert.deepEqual([...api.closestVirtualMode(1080, 2340)], [1080, 2400]);
});

test('extend creates one virtual display at the device resolution and asks the APK to connect', async () => {
  const f = fixture({ assignments: { 'tab-1': { mode: 'extend', autoConnect: true, quality: { ...constants.DEFAULT_SETTINGS.display.quality, preset: 'native' } } } });
  const result = await f.sessions.connect('tab-1');
  assert.equal(result.success, true);
  const attachCall = f.calls.find((c) => c[0] === 'attach-virtual-display');
  assert.ok(attachCall);
  assert.equal(attachCall[1], 2560);
  assert.equal(attachCall[2], 1600);
  // Native preset follows the chosen frame rate (30/60), capped by the panel refresh rate.
  assert.equal(attachCall[3], 60);
  assert.equal(f.calls.some((c) => c[0] === 'virtual-count' || c[0] === 'topology'), false);
  const connect = f.calls.find((c) => c[0] === 'connect');
  assert.equal(connect[2].port, 7523);
  assert.equal(connect[2].mode, 'extend');
  assert.ok(f.sessions.isExpectedSession(connect[2].sessionId, 'tab-1'));
  assert.equal(f.sessions.isExpectedSession('other', 'tab-1'), false);
});

test('accepted APK socket starts the renderer stream on the reserved virtual display', async () => {
  const f = fixture();
  await f.sessions.connect('tab-1');
  const sessionId = f.calls.find((c) => c[0] === 'connect')[2].sessionId;
  f.sessions.onDisplayConnected({ agentId: 'agent-9', deviceId: 'tab-1', sessionId });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const ready = f.events.find((e) => e[0] === 'session-ready')?.[1];
  assert.ok(ready);
  assert.equal(ready.sourceId, 'screen:100:0');
  assert.equal(ready.agentId, 'agent-9');
  assert.equal(f.sent[0][1].type, 'stream-config');
});

test('mirror never creates virtual displays and captures the chosen monitor', async () => {
  const f = fixture({ assignments: { 'tab-1': { mode: 'mirror', sourceDisplayId: '1', autoConnect: true } } });
  await f.sessions.connect('tab-1');
  assert.equal(f.calls.some((c) => c[0] === 'attach-virtual-display' || c[0] === 'mode'), false);
  assert.match(f.calls.find((c) => c[0] === 'connect')[2].label, /Espelho/);
});

test('refused resolution falls back to the closest supported virtual mode', async () => {
  const f = fixture({ modeRefused: (w) => w === 2412, assignments: { 'tab-1': { mode: 'extend', autoConnect: true, quality: { ...constants.DEFAULT_SETTINGS.display.quality, preset: 'custom', width: 2412, height: 1080, fps: 60 } } } });
  await f.sessions.connect('tab-1');
  const session = f.sessions.list()[0].session;
  assert.equal(session.quality.width, 2400);
  assert.equal(session.quality.height, 1080);
});

test('disconnecting the last extended receiver removes the virtual displays', async () => {
  const f = fixture();
  await f.sessions.connect('tab-1');
  await f.sessions.disconnect('tab-1');
  const detach = f.calls.find((c) => c[0] === 'detach-virtual-display');
  assert.ok(detach);
  assert.equal(detach[1], '\\\\.\\DISPLAY10');
  assert.ok(f.calls.some((c) => c[0] === 'disconnect'));
  assert.equal(f.sessions.list()[0].session, null);
});

test('keepVirtualDisplays leaves the virtual monitors in place', async () => {
  const f = fixture({ display: { keepVirtualDisplays: true } });
  await f.sessions.connect('tab-1');
  await f.sessions.disconnect('tab-1');
  assert.equal(f.calls.some((c) => c[0] === 'detach-virtual-display'), false);
});

test('driver failure is reported and no connect request reaches the APK', async () => {
  const f = fixture({ virtualFailure: true });
  const result = await f.sessions.connect('tab-1');
  assert.equal(result.success, false);
  assert.equal(f.calls.some((c) => c[0] === 'connect'), false);
  assert.equal(f.sessions.list()[0].session, null);
});

test('stream-config and session-ready carry audio: true by default, and false when assignment sets audio: false', async () => {
  const f1 = fixture();
  await f1.sessions.connect('tab-1');
  const sessionId1 = f1.calls.find((c) => c[0] === 'connect')[2].sessionId;
  f1.sessions.onDisplayConnected({ agentId: 'agent-1', deviceId: 'tab-1', sessionId: sessionId1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const streamConfig1 = f1.sent.find(([, msg]) => msg.type === 'stream-config')?.[1];
  assert.ok(streamConfig1);
  assert.equal(streamConfig1.payload.audio, true);
  const ready1 = f1.events.find((e) => e[0] === 'session-ready')?.[1];
  assert.ok(ready1);
  assert.equal(ready1.audio.enabled, true);

  const f2 = fixture({ assignments: { 'tab-1': { mode: 'extend', audio: false, autoConnect: true } } });
  await f2.sessions.connect('tab-1');
  const sessionId2 = f2.calls.find((c) => c[0] === 'connect')[2].sessionId;
  f2.sessions.onDisplayConnected({ agentId: 'agent-2', deviceId: 'tab-1', sessionId: sessionId2 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const streamConfig2 = f2.sent.find(([, msg]) => msg.type === 'stream-config')?.[1];
  assert.ok(streamConfig2);
  assert.equal(streamConfig2.payload.audio, false);
  const ready2 = f2.events.find((e) => e[0] === 'session-ready')?.[1];
  assert.ok(ready2);
  assert.equal(ready2.audio.enabled, false);
});

test('connect uses webrtc transport by default even when device supports native-h264', async () => {
  assert.equal(constants.DEFAULT_SETTINGS.display.transport, 'webrtc');
  const f = fixture({
    capabilities: ['webrtc', 'native-h264', 'pcm-audio'],
    nativeEncoder: {
      ffmpegPath: () => 'C:\\ffmpeg\\ffmpeg.exe',
      probeEncoders: async () => ['h264_nvenc'],
    },
    nativeStream: {
      NativeStreamSession: class extends EventEmitter {
        async start() {}
        async stop() {}
      },
    },
  });
  await f.sessions.connect('tab-1');
  const connect = f.calls.find((c) => c[0] === 'connect');
  assert.ok(connect);
  assert.equal(connect[2].transport, 'webrtc');
});

test('connect sends transport: native when display.transport is set to native and encoder is available', async () => {
  const f = fixture({
    display: { transport: 'native' },
    capabilities: ['webrtc', 'native-h264', 'pcm-audio'],
    nativeEncoder: {
      ffmpegPath: () => 'C:\\ffmpeg\\ffmpeg.exe',
      probeEncoders: async () => ['h264_nvenc'],
    },
    nativeStream: {
      NativeStreamSession: class extends EventEmitter {
        async start() {}
        async stop() {}
      },
    },
  });
  await f.sessions.connect('tab-1');
  const connect = f.calls.find((c) => c[0] === 'connect');
  assert.ok(connect);
  assert.equal(connect[2].transport, 'native');
  assert.equal(connect[2].streamPort, 47813);
});

test('webrtc-recover message from receiver re-emits session-ready to restart frozen video', async () => {
  const f = fixture();
  await f.sessions.connect('tab-1');
  const sessionId = f.calls.find((c) => c[0] === 'connect')[2].sessionId;
  f.sessions.onDisplayConnected({ agentId: 'agent-9', deviceId: 'tab-1', sessionId });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const initialReadyCount = f.events.filter((e) => e[0] === 'session-ready').length;
  assert.equal(initialReadyCount, 1);

  f.sessions.onDisplayMessage({
    agentId: 'agent-9',
    deviceId: 'tab-1',
    sessionId,
    type: 'webrtc-recover',
    payload: { reason: 'decoder-stalled' },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const afterRecoverCount = f.events.filter((e) => e[0] === 'session-ready').length;
  assert.equal(afterRecoverCount, 2);
});

test('connect falls back to webrtc transport when device lacks native-h264 capability', async () => {
  const f = fixture({
    capabilities: ['webrtc'],
    nativeEncoder: {
      ffmpegPath: () => 'C:\\ffmpeg\\ffmpeg.exe',
      probeEncoders: async () => ['h264_nvenc'],
    },
    nativeStream: {
      NativeStreamSession: class extends EventEmitter {
        async start() {}
        async stop() {}
      },
    },
  });
  await f.sessions.connect('tab-1');
  const connect = f.calls.find((c) => c[0] === 'connect');
  assert.ok(connect);
  assert.equal(connect[2].transport, 'webrtc');
});

test('every preset offers 30 fps with a reduced bitrate and keeps the resolution', () => {
  const base = { width: 0, height: 0, bitrateKbps: 0, codec: 'H264', priority: 'smoothness', orientation: 'landscape' };
  const at30 = constants.resolveQuality({ ...base, preset: 'balanced', fps: 30 });
  const at60 = constants.resolveQuality({ ...base, preset: 'balanced', fps: 60 });
  assert.equal(at30.width, 1920);
  assert.equal(at30.height, 1080);
  assert.equal(at30.fps, 30);
  assert.equal(at60.fps, 60);
  assert.ok(at30.bitrateKbps < at60.bitrateKbps);
  const native30 = constants.resolveQuality({ ...base, preset: 'native', fps: 30 }, { width: 2560, height: 1600, refreshRate: 120 });
  assert.equal(native30.fps, 30);
  assert.equal(native30.width, 2560);
  assert.deepEqual([...constants.PRESET_FPS_OPTIONS], [30, 60]);
});