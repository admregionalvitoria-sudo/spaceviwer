// SpaceViewer v2.2.9
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const cred = execSync('git credential fill', {
  input: 'protocol=https\nhost=github.com\n',
  encoding: 'utf-8'
});
const token = cred.match(/password=(.+)/)[1].trim();

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
    req.end();
  });
}

const pkg = require('../package.json');
const VERSION = pkg.version;

async function main() {
  console.log(`Criando release v${VERSION} no GitHub...`);
  const releaseRes = await request({
    hostname: 'api.github.com',
    path: '/repos/admregionalvitoria-sudo/spaceviwer/releases',
    method: 'POST',
    headers: {
      'User-Agent': 'SpaceViewer-App',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json'
    }
  }, {
    tag_name: `v${VERSION}`,
    target_commitish: 'main',
    name: `SpaceViewer v${VERSION} - Correção do Host Moonlight, Auto-Start e Descoberta por Hostname`,
    body: `### Novidades da Versão ${VERSION}\n\n- **Inicialização Automática do Host Moonlight**: O servidor GameStream SpaceviwerStream agora inicia automaticamente ao abrir o aplicativo, mantendo o host no estado Ativo (Pronto) sem necessidade de clique manual.\n- **Descoberta no Moonlight pelo Hostname do Computador**: O computador agora é anunciado e descoberto diretamente pelo nome de host do PC na rede local via mDNS (Bonjour com probe: false para evitar cancelamento de eco no Windows).\n- **Correção no Spawn do Binário Nativo**: Resolvido o parâmetro de inicialização que causava encerramento imediato do processo SpaceviwerStream.exe (status Host Parado).\n- **Identidade SpaceViewer no /serverinfo**: O servidor responde com o hostname real do computador sob a identidade SpaceViewer, sem nenhuma referência a SenaiStream.\n- **Sincronização de Smart TVs Pareadas**: Certificados de clientes em %LOCALAPPDATA%\\SpaceViewer\\clients são sincronizados e preservados.\n\nInstalador executável em anexo.`,
    draft: false,
    prerelease: false
  });

  let uploadUrl = releaseRes.body?.upload_url;

  if (!uploadUrl) {
    console.log('Buscando release existente...');
    const latest = await request({
      hostname: 'api.github.com',
      path: `/repos/admregionalvitoria-sudo/spaceviwer/releases/tags/v${VERSION}`,
      method: 'GET',
      headers: {
        'User-Agent': 'SpaceViewer-App',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    uploadUrl = latest.body?.upload_url;
    if (latest.body?.assets && Array.isArray(latest.body.assets)) {
      for (const asset of latest.body.assets) {
        if (asset.name === `SpaceViewer-Setup-${VERSION}.exe`) {
          console.log(`Excluindo asset anterior do GitHub (ID: ${asset.id})...`);
          await request({
            hostname: 'api.github.com',
            path: `/repos/admregionalvitoria-sudo/spaceviwer/releases/assets/${asset.id}`,
            method: 'DELETE',
            headers: {
              'User-Agent': 'SpaceViewer-App',
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/vnd.github.v3+json'
            }
          });
          console.log('Asset antigo removido com sucesso.');
        }
      }
    }
  }

  if (uploadUrl) {
    const finalUploadUrl = uploadUrl.replace('{?name,label}', `?name=SpaceViewer-Setup-${VERSION}.exe`);
    const parsed = new URL(finalUploadUrl);
    let exePath = path.resolve(__dirname, `../dist-package/SpaceViewer-Setup-${VERSION}.exe`);
    if (!fs.existsSync(exePath)) {
      exePath = path.resolve(__dirname, `../dist-build/SpaceViewer-Setup-${VERSION}.exe`);
    }
    if (!fs.existsSync(exePath)) {
      exePath = path.resolve(__dirname, `../dist-installer/SpaceViewer-Setup-${VERSION}.exe`);
    }
    if (!fs.existsSync(exePath)) {
      exePath = path.resolve(__dirname, `../release/SpaceViewer-Setup-${VERSION}.exe`);
    }
    if (!fs.existsSync(exePath)) {
      console.error('Arquivo executavel nao encontrado em:', exePath);
      return;
    }

    const stat = fs.statSync(exePath);
    console.log(`Fazendo upload do executável (${(stat.size / (1024 * 1024)).toFixed(1)} MB)...`);

    await new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(exePath);
      const uploadReq = https.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'User-Agent': 'SpaceViewer-App',
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/vnd.microsoft.portable-executable',
          'Content-Length': stat.size
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          console.log('Upload concluído com status:', res.statusCode);
          resolve();
        });
      });

      uploadReq.on('error', (e) => {
        console.error('Erro no upload:', e);
        reject(e);
      });
      fileStream.pipe(uploadReq);
    });
  }
  console.log('Release sincronizada com sucesso no GitHub!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
