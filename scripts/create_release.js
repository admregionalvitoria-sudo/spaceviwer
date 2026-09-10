const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');
const repo = 'admregionalvitoria-sudo/spaceviwer';
const version = require('../package.json').version;
const tag = `v${version}`;
const output = process.env.RELEASE_ASSET_DIR || path.join(root, 'dist-package');
const commit = process.env.RELEASE_COMMIT;
const notes = fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8');
function credentials() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  const response = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['pipe', 'pipe', 'pipe']
  });
  const token = response.match(/^password=(.+)$/m)?.[1]?.trim();
  if (!token) throw new Error('GitHub credentials unavailable');
  return token;
}
async function main() {
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Set RELEASE_COMMIT to the pushed source commit');
  const names = [`SpaceViewer-Setup-${version}.exe`, `SpaceViewer-Setup-${version}.exe.blockmap`, 'latest.yml'];
  const assets = names.map(name => ({ name, bytes: fs.readFileSync(path.join(output, name)) }));
  const manifest = yaml.load(assets[2].bytes.toString('utf8'));
  const sha512 = crypto.createHash('sha512').update(assets[0].bytes).digest('base64');
  if (manifest.version !== version || manifest.path !== names[0] || manifest.sha512 !== sha512 || manifest.files[0].size !== assets[0].bytes.length) throw new Error('Installer does not match latest.yml');
  const token = credentials();
  async function api(route, method = 'GET', body, binary = false) {
    const response = await fetch(route.startsWith('https:') ? route : `https://api.github.com/repos/${repo}${route}`, {
      method, headers: { 'User-Agent': 'SpaceViewer-Release', Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': binary ? 'application/octet-stream' : 'application/json' },
      ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(180000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`GitHub ${response.status}: ${data.message || 'request failed'}`);
    return data;
  }
  const head = await api('/commits/main');
  if (head.sha !== commit) throw new Error('main moved; verify source before publishing');
  const releases = await api('/releases?per_page=100');
  let release = releases.find(item => item.tag_name === tag);
  if (release && !release.draft) throw new Error('Version is already published; published assets will not be replaced');
  if (release && release.target_commitish !== commit) throw new Error('Existing draft targets different source');
  if (!release) release = await api('/releases', 'POST', { tag_name: tag, target_commitish: commit, name: `SpaceViewer ${tag} — servidor integrado e correções de telas`, body: notes, draft: true, prerelease: false });
  for (const asset of assets) {
    const digest = 'sha256:' + crypto.createHash('sha256').update(asset.bytes).digest('hex');
    let uploaded = release.assets.find(item => item.name === asset.name);
    if (!uploaded) {
      console.log(`Uploading ${asset.name} (${asset.bytes.length} bytes)`);
      uploaded = await api(release.upload_url.replace('{?name,label}', '') + '?name=' + encodeURIComponent(asset.name), 'POST', asset.bytes, true);
    }
    if (uploaded.state !== 'uploaded' || uploaded.size !== asset.bytes.length || uploaded.digest !== digest) throw new Error(`Asset verification failed: ${asset.name}`);
  }
  release = await api(`/releases/${release.id}`, 'PATCH', { draft: false, prerelease: false, make_latest: 'true', body: notes });
  console.log(`Published ${release.html_url}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
