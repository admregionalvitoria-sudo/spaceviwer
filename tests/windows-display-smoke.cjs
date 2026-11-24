// Read-only integration check. Run via Electron after bundling windows-displays.ts.
const { app, screen } = require('electron');
app.whenReady().then(async () => {
  try {
    const assert = require('node:assert/strict');
    const { getWindowsDisplayInventory, matchWindowsDisplay } = require('../scratch/windows-displays.cjs');
    const inventory = await getWindowsDisplayInventory();
    const matches = screen.getAllDisplays().map((display) => {
      const native = matchWindowsDisplay(display, inventory.displays);
      assert.ok(native, `Windows monitor not matched for Electron display ${display.id}`);
      return { id: display.id, deviceName: native.deviceName, isVirtual: native.isVirtual };
    });
    assert.equal(typeof inventory.enabled, 'boolean');
    assert.ok(inventory.enabled || inventory.count === 0);
    console.log(JSON.stringify({ installed: inventory.installed, enabled: inventory.enabled, count: inventory.count, matches }));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
