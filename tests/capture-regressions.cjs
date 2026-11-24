const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture(metadataUnavailable) {
  let captures = 0;
  const display = { id: 12, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 };
  const never = new Promise(() => {});
  const mocks = {
    electron: { screen: { getAllDisplays: () => [display], getPrimaryDisplay: () => display }, desktopCapturer: {
      getSources: async () => { captures++; return [{ id: 'screen:12:0', display_id: '12', thumbnail: { toDataURL: () => 'preview' } }]; },
    } },
    './projector': { getActiveProjectors: () => ({}) },
    './windows-displays': { getWindowsDisplayInventory: () => metadataUnavailable ? never : Promise.resolve({ displays: [] }), matchWindowsDisplay: () => undefined },
  };
  const load = (file, dependencies) => {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: name => dependencies[name] ?? require(name),
      setTimeout: (cb, ms) => setTimeout(cb, Math.min(ms, 15)), clearTimeout, console });
    return module.exports;
  };
  mocks['../shared/async'] = load('src/shared/async.ts', {});
  return { api: load('src/main/capture.ts', mocks), captures: () => captures };
}

test('physical screen and real capture source remain available when host metadata never responds', async () => {
  const { api } = fixture(true);
  const screens = await api.getScreensDetailed();
  assert.equal(screens.length, 1);
  assert.equal(screens[0].displayId, '12');
  assert.equal(screens[0].id, 'screen:12:0');
  assert.equal(screens[0].thumbnail, 'preview');
  assert.equal(screens[0].isVirtual, false);
});
test('simultaneous refresh requests share a single desktop capture and refresh again after completion', async () => {
  const { api, captures } = fixture(false);
  await Promise.all([api.getScreensDetailed(), api.getScreensDetailed(), api.getScreensDetailed()]);
  assert.equal(captures(), 1);
  await api.getScreensDetailed();
  assert.equal(captures(), 2);
});
