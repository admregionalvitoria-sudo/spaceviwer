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

async function main() {
  console.log('Criando release v2.2.1 no GitHub...');
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
    tag_name: 'v2.2.1',
    target_commitish: 'main',
    name: 'SpaceViewer v2.2.1 - Atualização de Design e Telas',
    body: `### Novidades da Versão 2.2.1\n\n- **Remoção Total de Emojis**: Interface 100% limpa com ícones vetoriais modernos (SVG).\n- **Ícone do Moonlight Atualizado**: Novo ícone em silhueta de lua crescente.\n- **Auto-Update Integrado**: Atualize diretamente pela aba de Ajustes/Configurações sem precisar reinstalar.\n- **Gerenciador de Telas como Início**: Monitoramento ao vivo de todas as telas físicas e virtuais.\n- **Transmissão Seletiva de Aplicativos**: Envie janelas de programas específicos para telas secundárias.\n\nInstalador executável em anexo.`,
    draft: false,
    prerelease: false
  });

  let uploadUrl = releaseRes.body?.upload_url;

  if (!uploadUrl) {
    console.log('Buscando release existente...');
    const latest = await request({
      hostname: 'api.github.com',
      path: '/repos/admregionalvitoria-sudo/spaceviwer/releases/tags/v2.2.1',
      method: 'GET',
      headers: {
        'User-Agent': 'SpaceViewer-App',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    uploadUrl = latest.body?.upload_url;
  }

  if (uploadUrl) {
    const finalUploadUrl = uploadUrl.replace('{?name,label}', '?name=SpaceViewer-Setup-2.2.1.exe');
    const parsed = new URL(finalUploadUrl);
    const exePath = path.resolve(__dirname, '../release/SpaceViewer-Setup-2.2.1.exe');
    if (!fs.existsSync(exePath)) {
      console.error('Arquivo executavel nao encontrado em:', exePath);
      return;
    }

    const stat = fs.statSync(exePath);
    console.log(`Fazendo upload do executável (${(stat.size / (1024 * 1024)).toFixed(1)} MB)...`);

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
      });
    });

    uploadReq.on('error', (e) => console.error('Erro no upload:', e));
    fileStream.pipe(uploadReq);
  }
}

main().catch(console.error);
