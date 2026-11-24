// Tests for WebRTC codec utilities (src/shared/webrtc/codec.ts).
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
    console,
    Buffer,
  });
  return module.exports;
}

const codec = load('src/shared/webrtc/codec.ts');

test('preferOpusStereo sets stereo=1, maxaveragebitrate=192000 and preserves existing keys', () => {
  const inputSdp = [
    'v=0',
    'o=- 123456 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 103',
    'c=IN IP4 0.0.0.0',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=20;useinbandfec=0;cbr=1',
    'a=rtpmap:103 ISAC/16000',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'c=IN IP4 0.0.0.0',
    'a=rtpmap:96 H264/90000',
  ].join('\r\n');

  const modified = codec.preferOpusStereo(inputSdp, 192);

  // Check that the modified SDP has the updated fmtp line
  const lines = modified.split('\r\n');
  const fmtpLine = lines.find((l) => l.startsWith('a=fmtp:111 '));
  assert.ok(fmtpLine, 'Opus fmtp line must exist');

  const params = fmtpLine.slice('a=fmtp:111 '.length).split(';').map((p) => p.trim());
  const paramMap = Object.fromEntries(params.map((p) => p.split('=')));

  assert.equal(paramMap.stereo, '1', 'stereo=1 must be set');
  assert.equal(paramMap['sprop-stereo'], '1', 'sprop-stereo=1 must be set');
  assert.equal(paramMap.maxaveragebitrate, '192000', 'maxaveragebitrate=192000 must be set');
  assert.equal(paramMap.useinbandfec, '1', 'useinbandfec=1 must be set');
  assert.equal(paramMap.minptime, '10', 'minptime=10 must be updated');
  assert.equal(paramMap.cbr, '1', 'existing key cbr=1 must be kept');

  // Verify non-audio m-lines are untouched
  assert.ok(lines.some((l) => l === 'a=rtpmap:96 H264/90000'));
});

test('preferOpusStereo creates fmtp line if Opus has no existing fmtp in m=audio', () => {
  const inputSdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
  ].join('\n');

  const modified = codec.preferOpusStereo(inputSdp, 256);
  const lines = modified.split('\n');
  const fmtpLine = lines.find((l) => l.startsWith('a=fmtp:111 '));
  assert.ok(fmtpLine, 'Opus fmtp line must be created');
  assert.match(fmtpLine, /stereo=1/);
  assert.match(fmtpLine, /maxaveragebitrate=256000/);
});
