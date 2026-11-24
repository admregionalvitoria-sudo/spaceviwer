const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => mocks[name] ?? require(name),
    process: { ...process, platform: 'win32' }, Buffer, console, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 1)) });
  return module.exports;
}
for (const action of ['enable', 'install', 'set-count']) {
  test(`${action} never treats an enabled PnP adapter without a virtual desktop as success`, async () => {
    const api = load('src/main/windows-displays.ts', {
      electron: { app: { isPackaged: false, getAppPath: () => path.resolve(__dirname, '..') } },
      '../shared/constants': { MAX_VIRTUAL_DISPLAYS: 4 },
      './windows-powershell': { psLiteral: s => `'${s}'`, runPowerShell: async script => script.includes('-Action query')
        ? JSON.stringify({ installed: true, enabled: true, active: false, count: 0, configuredCount: 1, displays: [] }) : '' },
    });
    const response = await api.changeVirtualDisplays(action);
    assert.equal(response.success, false);
    assert.match(response.error, /não disponibilizou nenhuma saída de tela virtual/);
  });
}
test('PowerShell launch failures never expose encoded commands in UI errors', async () => {
  const api = load('src/main/windows-powershell.ts', {
    child_process: { execFile(exe, args, options, callback) {
      callback(new Error('Command failed: powershell.exe -EncodedCommand ' + 'A'.repeat(500)), '', '');
    } },
  });
  await assert.rejects(api.runPowerShell('exit 1', true), error => {
    assert.doesNotMatch(error.message, /EncodedCommand|A{50}/);
    assert.match(error.message, /Windows não concluiu/);
    return true;
  });
});
