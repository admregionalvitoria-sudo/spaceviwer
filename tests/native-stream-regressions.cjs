// Unit and regression tests for native stream encoding and Annex-B splitting.
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

const { AnnexBSplitter, buildArgs, supportsIntraRefresh } = load('src/main/native-encoder.ts');

test('AnnexBSplitter splits synthetic stream of 3 AUs fed in random chunks', () => {
  // AU 1: Keyframe (AUD [9] + SPS [7] + PPS [8] + IDR [5])
  const au1 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x01, 0x09, 0xf0]),
    Buffer.from([0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0xc0, 0x1f, 0x8c]),
    Buffer.from([0x00, 0x00, 0x00, 0x01, 0x68, 0xce, 0x06, 0xe2]),
    Buffer.from([0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x00, 0x10, 0xff]),
  ]);

  // AU 2: Non-keyframe P-frame (AUD [9] + P-slice [1])
  const au2 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x01, 0x09, 0x30]),
    Buffer.from([0x00, 0x00, 0x00, 0x01, 0x41, 0x9a, 0x22, 0x55, 0xaa]),
  ]);

  // AU 3: Non-keyframe P-frame (AUD [9] + P-slice [1])
  const au3 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x01, 0x09, 0x10]),
    Buffer.from([0x00, 0x00, 0x00, 0x01, 0x41, 0x77, 0x88, 0x99]),
  ]);

  const fullStream = Buffer.concat([au1, au2, au3]);
  const splitter = new AnnexBSplitter();
  const collected = [];

  // Feed in various random-like chunk sizes (3, 7, 11, 2, 5...)
  const chunkSizes = [3, 7, 11, 2, 5, 8, 1, 13, 4];
  let offset = 0;
  let chunkIdx = 0;
  while (offset < fullStream.length) {
    const size = chunkSizes[chunkIdx % chunkSizes.length];
    const end = Math.min(offset + size, fullStream.length);
    const chunk = fullStream.subarray(offset, end);
    const results = splitter.push(chunk);
    for (const r of results) collected.push(r);
    offset = end;
    chunkIdx++;
  }

  // The last AU is still in buffer until flush() or next AUD
  assert.equal(collected.length, 2);
  assert.equal(collected[0].keyframe, true);
  assert.deepEqual(collected[0].data, au1);

  assert.equal(collected[1].keyframe, false);
  assert.deepEqual(collected[1].data, au2);

  // flush() returns the pending last AU
  const flushed = splitter.flush();
  assert.ok(flushed);
  assert.equal(flushed.keyframe, false);
  assert.deepEqual(flushed.data, au3);

  // Subsequent flush returns null
  assert.equal(splitter.flush(), null);
});

test('buildArgs for nvenc contains hardware flags and options', () => {
  const args = buildArgs({
    encoder: 'h264_nvenc',
    hmonitor: 123,
    fps: 60,
    bitrateKbps: 10000,
  });

  const cmdLine = args.join(' ');
  assert.ok(cmdLine.includes('-init_hw_device cuda=cu'), 'must contain cuda init');
  assert.ok(cmdLine.includes('gfxcapture=hmonitor=123'), 'must contain gfxcapture with hmonitor');
  assert.ok(cmdLine.includes('-tune ull'), 'must contain -tune ull');
  assert.ok(cmdLine.includes('-bf 0'), 'must contain -bf 0');
  assert.ok(cmdLine.includes('-intra-refresh 1'), 'must contain -intra-refresh 1');
  assert.ok(!cmdLine.includes('-forced-idr'), 'must not contain -forced-idr');
  assert.ok(!cmdLine.includes('-force_key_frames'), 'must not contain -force_key_frames');
  assert.ok(cmdLine.includes('aud=insert'), 'must contain aud=insert');
});

test('buildArgs for mirror mode contains scale_aspect resize parameters', () => {
  const args = buildArgs({
    encoder: 'h264_nvenc',
    hmonitor: 123,
    fps: 60,
    bitrateKbps: 8000,
    width: 1280,
    height: 720,
  });

  const cmdLine = args.join(' ');
  assert.ok(
    cmdLine.includes('width=1280:height=720:resize_mode=scale_aspect'),
    'must contain aspect scaling parameters for mirror mode'
  );
});

test('buildArgs for qsv and mf variants contain format=nv12 and correct refresh/keyframe flags', () => {
  const qsvArgs = buildArgs({
    encoder: 'h264_qsv',
    hmonitor: 123,
    fps: 60,
    bitrateKbps: 8000,
  });
  const qsvCmd = qsvArgs.join(' ');
  assert.ok(qsvCmd.includes('format=nv12'), 'qsv must contain format=nv12');
  assert.ok(qsvCmd.includes('-c:v h264_qsv'), 'must use h264_qsv');
  assert.ok(qsvCmd.includes('-int_ref_type vertical'), 'qsv must use int_ref_type vertical');
  assert.ok(qsvCmd.includes('-int_ref_cycle_size 60'), 'qsv must use int_ref_cycle_size');
  assert.ok(!qsvCmd.includes('-force_key_frames'), 'qsv must not contain -force_key_frames');

  const mfArgs = buildArgs({
    encoder: 'h264_mf',
    hmonitor: 123,
    fps: 60,
    bitrateKbps: 8000,
  });
  const mfCmd = mfArgs.join(' ');
  assert.ok(mfCmd.includes('format=nv12'), 'mf must contain format=nv12');
  assert.ok(mfCmd.includes('-c:v h264_mf'), 'must use h264_mf');
  assert.ok(mfCmd.includes('-force_key_frames expr:gte(t,n_forced*2)'), 'mf must contain force_key_frames');

  assert.equal(supportsIntraRefresh('h264_nvenc'), true);
  assert.equal(supportsIntraRefresh('h264_qsv'), true);
  assert.equal(supportsIntraRefresh('h264_mf'), false);
});
