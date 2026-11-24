// Unit and regression tests for CongestionController.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function load(file, mocks = {}) {
  const module = { exports: {} };
  vm.runInNewContext(transpile(file), {
    module,
    exports: module.exports,
    require: (name) => mocks[name] ?? require(name),
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer,
    Promise,
    process,
  });
  return module.exports;
}

const { CongestionController } = load('src/main/congestion-controller.ts');

test('entering and leaving drop mode with hysteresis', () => {
  let currentTime = 1000;
  const controller = new CongestionController({
    targetKbps: 10000,
    minKbps: 1500,
    now: () => currentTime,
  });

  const frameEstimate = 20000; // ~20KB per frame

  // Initial state: not dropping
  assert.equal(controller.shouldDropVideo(0, frameEstimate), false);

  // Establish base RTT: 20 ms
  controller.onRtt(20);
  assert.equal(controller.queueDelayMs, 0);

  // A small backlog (one or two frames) is normal and must NOT trigger dropping
  assert.equal(controller.shouldDropVideo(35000, frameEstimate), false);

  // Writable queue exceeds max(64 KiB, 4 * estimate) -> enters drop mode
  assert.equal(controller.shouldDropVideo(90000, frameEstimate), true);

  // Writable queue drops to 20KB (above the 16 KiB exit level) -> remains in drop mode (hysteresis)
  assert.equal(controller.shouldDropVideo(20000, frameEstimate), true);

  // Writable queue drops to 0, queueDelay < 30 -> leaves drop mode
  assert.equal(controller.shouldDropVideo(0, frameEstimate), false);

  // Now test entry via queueDelay > 80 ms
  // base is 20ms, feed RTT 150ms -> EWMA rises:
  // sample 1: 0.75*20 + 0.25*150 = 52.5
  controller.onRtt(150);
  // sample 2: 0.75*52.5 + 0.25*150 = 76.875
  controller.onRtt(150);
  // sample 3: 0.75*76.875 + 0.25*150 = 95.15 -> queueDelay ~75.15
  controller.onRtt(150);
  // sample 4: 0.75*95.15 + 0.25*150 = 108.8 -> queueDelay ~88.8 > 80
  controller.onRtt(150);
  assert.ok(controller.queueDelayMs > 80, `queueDelayMs should be > 80, got ${controller.queueDelayMs}`);

  // Even with writable = 0, queueDelay > 80 enters drop mode
  assert.equal(controller.shouldDropVideo(0, frameEstimate), true);

  // If queueDelay drops to 50ms (between 30 and 80): stays in drop mode (hysteresis)
  controller.onRtt(40);
  controller.onRtt(40);
  assert.ok(controller.queueDelayMs >= 30, 'queueDelay should still be >= 30');
  assert.equal(controller.shouldDropVideo(0, frameEstimate), true);

  // When queueDelay drops below 30ms and writable === 0: leaves drop mode
  controller.onRtt(20);
  controller.onRtt(20);
  controller.onRtt(20);
  assert.ok(controller.queueDelayMs < 30, 'queueDelay should now be < 30');
  assert.equal(controller.shouldDropVideo(0, frameEstimate), false);
});

test('sustained drops step the bitrate down by 30% at most once per 4 s and never below min', () => {
  let currentTime = 10000;
  const controller = new CongestionController({
    targetKbps: 10000,
    minKbps: 2000,
    now: () => currentTime,
  });

  // Initially at target
  assert.equal(controller.bitrateKbps, 10000);

  // Feed 10 frames in the last 2 seconds, with 2 dropped (20% drop > 5%)
  for (let i = 0; i < 8; i++) controller.onFrame(true);
  controller.onFrame(false);
  controller.onFrame(false);

  // Tick before 4 seconds have passed since init (e.g. +2s)
  currentTime += 2000;
  let res = controller.tick();
  assert.equal(res.changed, false, 'must not step down before 4s');
  assert.equal(controller.bitrateKbps, 10000);

  // Tick at +4s since init -> steps down by 30% (10000 * 0.7 = 7000)
  currentTime += 2000; // total 4s since start
  // maintain drop ratio
  controller.onFrame(false);
  res = controller.tick();
  assert.equal(res.changed, true, 'must step down after 4s sustained drops');
  assert.equal(res.bitrateKbps, 7000);
  assert.equal(controller.bitrateKbps, 7000);

  // Next second (+1s): cannot step down yet
  currentTime += 1000;
  controller.onFrame(false);
  res = controller.tick();
  assert.equal(res.changed, false);
  assert.equal(controller.bitrateKbps, 7000);

  // Advance to 4s after last change (another 3s): steps down (7000 * 0.7 = 4900)
  currentTime += 3000;
  controller.onFrame(false);
  res = controller.tick();
  assert.equal(res.changed, true);
  assert.equal(res.bitrateKbps, 4900);

  // Advance another 4s: 4900 * 0.7 = 3430
  currentTime += 4000;
  controller.onFrame(false);
  res = controller.tick();
  assert.equal(res.changed, true);
  assert.equal(res.bitrateKbps, 3430);

  // Advance another 4s: 3430 * 0.7 = 2401
  currentTime += 4000;
  controller.onFrame(false);
  res = controller.tick();
  assert.equal(res.changed, true);
  assert.equal(res.bitrateKbps, 2401);

  // Advance another 4s: 2401 * 0.7 = 1680.7 -> clamped to minKbps (2000)
  currentTime += 4000;
  controller.onFrame(false);
  res = controller.tick();
  assert.equal(res.changed, true);
  assert.equal(res.bitrateKbps, 2000);

  // Advance another 4s with drops: already at min (2000), never goes below min!
  currentTime += 4000;
  controller.onFrame(false);
  res = controller.tick();
  assert.equal(res.changed, false, 'should not report changed when already at min');
  assert.equal(controller.bitrateKbps, 2000);
});

test('20 s clean steps it up by 15% but never above target', () => {
  let currentTime = 10000;
  const controller = new CongestionController({
    targetKbps: 6000,
    minKbps: 2000,
    now: () => currentTime,
  });

  // Force bitrate down to 4000 via drops
  currentTime += 4000;
  for (let i = 0; i < 5; i++) controller.onFrame(false);
  let res = controller.tick(); // 6000 * 0.7 = 4200
  assert.equal(res.bitrateKbps, 4200);

  // Now clean period starts: no drops, low RTT
  controller.onRtt(20);

  // 10s clean: tick should NOT step up yet
  for (let i = 0; i < 10; i++) {
    currentTime += 1000;
    controller.onFrame(true);
    controller.onRtt(20);
    res = controller.tick();
    assert.equal(res.changed, false);
  }

  // At 20s clean (+10s more): tick steps up by 15% (4200 * 1.15 = 4830)
  for (let i = 0; i < 10; i++) {
    currentTime += 1000;
    controller.onFrame(true);
    controller.onRtt(20);
    res = controller.tick();
  }
  assert.equal(res.changed, true, 'must step up after 20s clean');
  assert.equal(res.bitrateKbps, 4830);

  // Another 20s clean: 4830 * 1.15 = 5554.5 -> 5555
  for (let i = 0; i < 20; i++) {
    currentTime += 1000;
    controller.onFrame(true);
    controller.onRtt(20);
    res = controller.tick();
  }
  assert.equal(res.changed, true);
  assert.equal(res.bitrateKbps, 5555);

  // Another 20s clean: 5555 * 1.15 = 6388 -> capped at target (6000)
  for (let i = 0; i < 20; i++) {
    currentTime += 1000;
    controller.onFrame(true);
    controller.onRtt(20);
    res = controller.tick();
  }
  assert.equal(res.changed, true);
  assert.equal(res.bitrateKbps, 6000);

  // Further clean ticks do not exceed target
  currentTime += 20000;
  res = controller.tick();
  assert.equal(res.changed, false);
  assert.equal(controller.bitrateKbps, 6000);
});

test('setTarget below current lowers current immediately', () => {
  let currentTime = 10000;
  const controller = new CongestionController({
    targetKbps: 10000,
    minKbps: 1500,
    now: () => currentTime,
  });

  assert.equal(controller.bitrateKbps, 10000);

  controller.setTarget(6500);
  assert.equal(controller.bitrateKbps, 6500, 'setTarget below current must immediately lower current');

  // setTarget above current does not immediately increase current
  controller.setTarget(8000);
  assert.equal(controller.bitrateKbps, 6500, 'setTarget above current must not immediately raise current');
});

test('shouldDropAudio drops only when queueDelay > 300 ms', () => {
  let currentTime = 1000;
  const controller = new CongestionController({
    targetKbps: 5000,
    now: () => currentTime,
  });

  controller.onRtt(20);
  assert.equal(controller.shouldDropAudio(), false);

  // Increase RTT to produce queueDelay > 300
  // base is 20, feed 400 multiple times
  for (let i = 0; i < 10; i++) {
    controller.onRtt(400);
  }
  assert.ok(controller.queueDelayMs > 300, `queueDelay should be > 300, got ${controller.queueDelayMs}`);
  assert.equal(controller.shouldDropAudio(), true);
});
