// Actual Electron-to-native lifecycle; requires the standard host ports to be free.
const { app } = require('electron');
const assert = require('node:assert/strict');
app.whenReady().then(async () => {
  const host = require('../scratch/gamestream-host.cjs');
  try {
    assert.equal(await host.startHost(), true);
    assert.equal(await host.checkHostStatus(), 'running');
    const displays = await host.getHostDisplays();
    assert.ok(displays.length > 0);
    assert.ok(displays.every(display => display.deviceName));
    assert.equal((await host.refreshHostCapture()).success, true);
    assert.ok(Array.isArray(await host.getNativeSessions()));
    console.log(JSON.stringify({ host: 'running', displays: displays.length, captureRefresh: 'ok' }));
    await host.stopHost();
    assert.equal(await host.checkHostStatus(), 'stopped');
    app.exit(0);
  } catch (error) {
    console.error(error);
    await host.stopHost().catch(console.error);
    app.exit(1);
  }
});
