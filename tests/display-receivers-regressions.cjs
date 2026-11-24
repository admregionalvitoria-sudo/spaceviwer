// Discovery / control of the SpaceViewer Display APK against a fake device on 127.0.0.1.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const dgram = require('node:dgram');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => mocks[name] ?? require(name), console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval, Buffer, Promise });
  return module.exports;
}

const constants = load('src/shared/constants.ts');
const { DisplayReceivers, parseDeviceInfo } = load('src/main/display-receivers.ts', { '../shared/constants': constants });

const info = (overrides = {}) => ({
  type: 'spaceviewer-display', protocol: 1, id: 'dev-1', name: 'Tablet Sala', model: 'SM-X710', manufacturer: 'samsung', android: '14',
  appVersion: '3.0.0', ip: '10.0.0.99', controlPort: 47811, width: 1600, height: 2560, refreshRate: 120, density: 2, orientation: 'landscape',
  state: 'idle', connectedTo: null, ...overrides,
});

function freePort(type) {
  return new Promise((resolve) => {
    if (type === 'udp') {
      const s = dgram.createSocket('udp4');
      s.bind(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    } else {
      const s = http.createServer();
      s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    }
  });
}

async function fakeApk() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null, type: req.headers['content-type'] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.url === '/info' ? info() : { ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const udp = dgram.createSocket('udp4');
  const probes = [];
  udp.on('message', (msg, rinfo) => {
    probes.push(msg.toString());
    if (msg.toString() === 'SPACEVIEWER_DISCOVER_V1') udp.send(Buffer.from(JSON.stringify(info({ state: 'streaming' }))), rinfo.port, rinfo.address);
  });
  await new Promise((resolve) => udp.bind(0, '127.0.0.1', resolve));
  return { server, udp, requests, probes, controlPort: server.address().port, discoveryPort: udp.address().port,
    close: () => { server.close(); udp.close(); } };
}

test('DeviceInfo parsing accepts only SpaceViewer displays and normalizes landscape size', () => {
  assert.equal(parseDeviceInfo('{"type":"other","id":"x"}'), null);
  assert.equal(parseDeviceInfo('not json'), null);
  const parsed = parseDeviceInfo(JSON.stringify(info()));
  assert.equal(parsed.width, 2560);
  assert.equal(parsed.height, 1600);
  assert.equal(parsed.state, 'idle');
});

test('parseDeviceInfo keeps capabilities and streamPort and provides defaults', () => {
  const withoutNewFields = parseDeviceInfo(JSON.stringify(info()));
  assert.equal(withoutNewFields.capabilities.length, 0);
  assert.equal(withoutNewFields.streamPort, 47813);

  const withNewFields = parseDeviceInfo(JSON.stringify(info({
    capabilities: ['webrtc', 'native-h264', 'pcm-audio'],
    streamPort: 47813,
  })));
  assert.equal(withNewFields.capabilities.length, 3);
  assert.equal(withNewFields.capabilities[0], 'webrtc');
  assert.equal(withNewFields.capabilities[1], 'native-h264');
  assert.equal(withNewFields.capabilities[2], 'pcm-audio');
  assert.equal(withNewFields.streamPort, 47813);
});

test('manual add, direct probe refresh and /connect body follow the protocol', async () => {
  const apk = await fakeApk();
  const announce = await freePort('udp');
  const receivers = new DisplayReceivers({ discovery: apk.discoveryPort, announce, control: apk.controlPort });
  receivers.start();
  try {
    const added = await receivers.addManual('127.0.0.1');
    assert.equal(added.id, 'dev-1');
    assert.equal(added.ip, '127.0.0.1');
    assert.equal(receivers.isOnline('dev-1'), true);

    // A scan probes known devices directly; the reply updates their state.
    await receivers.scan(300);
    assert.ok(apk.probes.includes('SPACEVIEWER_DISCOVER_V1'));
    assert.equal(receivers.get('dev-1').state, 'streaming');

    await receivers.connect('dev-1', { host: '127.0.0.1', port: 7523, masterName: 'PC', sessionId: 's-1', mode: 'extend', label: 'Tela virtual 1', orientation: 'landscape' });
    const connect = apk.requests.find((r) => r.url === '/connect');
    assert.equal(connect.method, 'POST');
    assert.match(connect.type, /application\/json/);
    assert.deepEqual(connect.body, { host: '127.0.0.1', port: 7523, masterName: 'PC', sessionId: 's-1', mode: 'extend', label: 'Tela virtual 1', orientation: 'landscape' });

    await receivers.disconnect('dev-1');
    assert.ok(apk.requests.some((r) => r.url === '/disconnect' && r.method === 'POST'));
  } finally {
    receivers.stop();
    apk.close();
  }
});

test('announcements on the passive port add devices with the sender address', async () => {
  const announce = await freePort('udp');
  const receivers = new DisplayReceivers({ discovery: await freePort('udp'), announce });
  receivers.start();
  const updated = new Promise((resolve) => receivers.once('updated', resolve));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const sender = dgram.createSocket('udp4');
  sender.send(Buffer.from(JSON.stringify(info({ id: 'dev-2', ip: '10.9.9.9' }))), announce, '127.0.0.1');
  try {
    const list = await updated;
    const device = list.find((d) => d.id === 'dev-2');
    assert.ok(device);
    assert.equal(device.ip, '127.0.0.1');
  } finally {
    sender.close();
    receivers.stop();
  }
});

test('invalid manual address is rejected without a network call', async () => {
  const receivers = new DisplayReceivers({ discovery: await freePort('udp'), announce: await freePort('udp') });
  await assert.rejects(receivers.addManual('tablet.local'), /IPv4/);
});
