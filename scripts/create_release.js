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
    name: `SpaceViewer v${VERSION} - Controle Dinâmico de Telas Virtuais e SpaceviwerStream`,
    body: `### Novidades da Versão ${VERSION}\n\n- **Controle Dinâmico de Telas Virtuais**: Adição de barra de controle na aba Telas permitindo adicionar ou remover telas virtuais sob demanda (1 a 4 telas) ou desativar completamente quando não estiver usando.\n- **Conexão Individual no Moonlight**: O Moonlight detecta e permite conectar dinamicamente a cada tela virtual ativa.\n- **Renomeação Completa para SpaceviwerStream**: Padronização e remoção total de referências legadas em todo o sistema, executáveis e instalador.\n- **Atualização de Drivers e PnP**: Sincronização automática do XML de configuração do driver virtual e reinício sob demanda.\n\nInstalador executável em anexo.`,
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
