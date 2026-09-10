const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');

function hostFixture(options = {}) {
  const root = path.resolve(__dirname, '..');
  const calls = [];
  let count = options.count ?? 1;
  const native = { deviceName: '\\\\.\\DISPLAY7', x: 0, y: 0, width: 1920, height: 1080, primary: false, isVirtual: true };
  const inventory = async () => ({ installed: true, active: count > 0, enabled: count > 0, count, displays: [native] });
  const bundled = path.join(root, 'resources', 'spaceviwerstream', 'SpaceviwerStream.exe');
  const responses = {
    '/api/status': options.owner ? { active: false } : { active: false, hostType: 'SpaceViewer', apiVersion: 2 },
    '/api/settings': { display: 0, width: 1920, height: 1080, fps: 60, bitrateMbps: 20, hardware: true, virtualDisplay: false },
    '/api/displays': { displays: [{ index: 3, name: 'Virtual', deviceName: native.deviceName, width: 1920, height: 1080, primary: false, virtual: true }] },
    ...options.responses,
  };
  const http = {
    request(request, callback) {
      const req = new EventEmitter();
      let body = '';
      req.write = (data) => { body += data; };
      req.destroy = () => {};
      req.end = () => {
        calls.push({ type: 'http', path: request.path, method: request.method, body });
        queueMicrotask(() => {
          const response = new EventEmitter();
          response.statusCode = options.topologyFailure && request.path === "/api/display-mode" ? 500 : 200;
          callback(response);
          response.emit('data', JSON.stringify(responses[request.path] ?? {}));
          response.emit('end');
        });
      };
      return req;
    },
  };
  const mocks = {
    electron: { app: { isPackaged: false, getAppPath: () => root }, screen: { getAllDisplays: () => [{ id: 200, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }], dipToScreenRect: (_, bounds) => bounds } },
    http,
    './windows-displays': {
      getWindowsDisplayInventory: inventory,
      invalidateDisplayInventory() {},
      matchWindowsDisplay: () => native,
      changeVirtualDisplays: async (action, target) => {
        calls.push({ type: 'driver', action, count: target });
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (options.driverFailure) return { success: false, error: 'device refused' };
        count = action === 'disable' ? 0 : target;
        return { success: true };
      },
    },
    './windows-powershell': {
      psLiteral: (s) => `'${s.replace(/'/g, "''")}'`,
      runPowerShell: async (script) => {
        if (script.includes('Get-NetTCPConnection')) return options.owner ?? bundled;
        calls.push({ type: 'powershell', script });
        if (options.topologyFailure) throw new Error('topology failed');
        return '';
      },
    },
    child_process: { spawn: () => { throw new Error('Test must not launch a real host'); }, exec: () => {} },
  };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/main/gamestream-host.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => mocks[name] ?? require(name),
    process, Buffer, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, console: { log() {}, warn() {}, error() {} } });
  return { api: module.exports, calls };
}

test('last virtual display is disabled and returned count comes from Windows', async () => {
  const { api, calls } = hostFixture();
  const result = await api.removeVirtualDisplay();
  assert.equal(result.success, true);
  assert.equal(result.count, 0);
  assert.equal(calls[0].action, 'disable');
});

test('failed removal never reports a lower count or success', async () => {
  const { api } = hostFixture({ count: 2, driverFailure: true });
  const result = await api.removeVirtualDisplay();
  assert.equal(result.success, false);
  assert.equal(result.count, 2);
});

test('concurrent removal requests read the updated device state in sequence', async () => {
  const { api } = hostFixture({ count: 2 });
  const results = await Promise.all([api.removeVirtualDisplay(), api.removeVirtualDisplay()]);
  assert.deepEqual(results.map((r) => r.count), [1, 0]);
});

test('capture source identifier is resolved through display_id and native device name', async () => {
  const { api, calls } = hostFixture();
  const result = await api.setMoonlightScreen('screen:984374:0', [{ id: 'screen:984374:0', displayId: '200' }]);
  assert.equal(result.success, true);
  const update = calls.find((c) => c.type === 'http' && c.method === 'POST');
  const body = new URLSearchParams(update.body);
  assert.equal(body.get('display'), '3');
  assert.equal(body.get('virtualDisplay'), '1');
});

test('removed screens fail without silently broadcasting the primary monitor', async () => {
  const { api, calls } = hostFixture();
  const result = await api.setMoonlightScreen('screen:99:0', []);
  assert.equal(result.success, false);
  assert.equal(calls.length, 0);
});

test('native camelCase deviceName is preserved instead of inventing DISPLAYn', async () => {
  const { api } = hostFixture();
  const displays = await api.getHostDisplays();
  assert.equal(displays.length, 1);
  assert.equal(displays[0].deviceName, '\\\\.\\DISPLAY7');
  assert.equal(displays[0].index, 3);
});

test('failed Windows topology change is surfaced without posting capture changes', async () => {
  const { api, calls } = hostFixture({ topologyFailure: true });
  const result = await api.setDisplayMode('extended');
  assert.equal(result.success, false);
  assert.ok(result.error);
  assert.equal(calls.filter((c) => c.type === 'http' && c.method === 'POST' && c.path === '/api/settings').length, 0);
});

test('a different server on port 47990 is never accepted or sent settings', async () => {
  const { api, calls } = hostFixture({ owner: 'C:\\Program Files\\SenaiStream\\SenaiStreamTray.exe' });
  assert.equal(await api.checkHostStatus(), 'stopped');
  const update = await api.setHostSettings({ fps: 30 });
  assert.equal(update.success, false);
  assert.match(update.error, /SenaiStream/);
  await assert.rejects(api.startHost(), /SenaiStream/);
  assert.equal(calls.filter((c) => c.type === 'http' && c.method === 'POST').length, 0);
});
test('audio selection targets one TV and the exact window handle', async () => {
  const { api, calls } = hostFixture();
  assert.equal((await api.setNativeSessionAudio('10.0.0.22', 'window:123456:0')).success, true);
  const mutation = calls.find(call => call.path === '/api/session-audio');
  assert.equal(new URLSearchParams(mutation.body).get('address'), '10.0.0.22');
  assert.equal(new URLSearchParams(mutation.body).get('window'), '123456');
  assert.ok(!calls.some(call => call.path === '/api/settings'));
});
test('audio selection rejects a desktop source instead of capturing system audio', async () => {
  const { api, calls } = hostFixture();
  assert.equal((await api.setNativeSessionAudio('10.0.0.22', 'screen:0:0')).success, false);
  assert.equal(calls.length, 0);
});
test('audio can be silenced independently for one TV', async () => {
  const { api, calls } = hostFixture();
  assert.equal((await api.setNativeSessionAudio('10.0.0.23', 'none')).success, true);
  const mutation = calls.find(call => call.path === '/api/session-audio');
  assert.equal(new URLSearchParams(mutation.body).get('window'), '0');
});
test('shared Windows audio uses the system mode for the selected TV', async () => {
  const { api, calls } = hostFixture();
  assert.equal((await api.setNativeSessionAudio('10.0.0.22', 'system')).success, true);
  const mutation = calls.find(call => call.path === '/api/session-audio');
  const form = new URLSearchParams(mutation.body);
  assert.equal(form.get('mode'), 'system');
  assert.equal(form.get('window'), '0');
  assert.equal(form.get('address'), '10.0.0.22');
});
