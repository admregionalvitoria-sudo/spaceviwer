// SpaceViewer v2.2.9
// ============================================================
// SpaceViewer — GitHub Auto-Updater Module
// ============================================================

import { app, BrowserWindow } from 'electron';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { APP_VERSION } from '../shared/constants';

export const GITHUB_REPO_OWNER = 'admregionalvitoria-sudo';
export const GITHUB_REPO_NAME = 'spaceviwer';

export interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  releaseDate: string;
  downloadUrl?: string;
  assetName?: string;
  assetSize?: number;
  htmlUrl?: string;
  error?: string;
}

export interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  speed: number;
}

function compareVersions(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/i, '').trim();
  const clean2 = v2.replace(/^v/i, '').trim();
  const p1 = clean1.split('.').map((n) => parseInt(n, 10) || 0);
  const p2 = clean2.split('.').map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(p1.length, p2.length);
  for (let i = 0; i < maxLen; i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/** Reads the public release manifest without using GitHub's rate-limited REST API. */
function fetchManifest(url: string, redirects = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirects > 5 || new URL(url).protocol !== 'https:') {
      reject(new Error('Redirecionamento inválido no servidor de atualizações')); return;
    }
    const req = https.get(url, { headers: { 'User-Agent': 'SpaceViewer-App', Accept: 'text/plain' } }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchManifest(new URL(res.headers.location, url).href, redirects + 1).then(resolve, reject); return;
      }
      if (res.statusCode !== 200) {
        res.resume(); reject(new Error('Servidor de atualizações retornou código ' + res.statusCode)); return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        data += chunk;
        if (data.length > 65536) req.destroy(new Error('Manifesto de atualização muito grande'));
      });
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('Conexão de atualização interrompida')));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Tempo limite de conexão esgotado')));
  });
}

/** Parses only the scalar fields written by electron-builder; rejects unexpected installer paths. */
function publicRelease(manifest: string) {
  const field = (name: string) => {
    const value = manifest.match(new RegExp('^' + name + ': *(.+)$', 'm'))?.[1]?.trim() || '';
    return value.replace(/^['"]|['"]$/g, '');
  };
  const version = field('version');
  const asset = field('path');
  if (!/^\d+\.\d+\.\d+$/.test(version) || asset !== 'SpaceViewer-Setup-' + version + '.exe') {
    throw new Error('Manifesto de atualização inválido');
  }
  const base = 'https://github.com/' + GITHUB_REPO_OWNER + '/' + GITHUB_REPO_NAME + '/releases';
  return {
    tag_name: 'v' + version, name: 'SpaceViewer ' + version,
    body: 'Consulte as novidades na página desta versão.', published_at: field('releaseDate'),
    html_url: base + '/tag/v' + version,
    assets: [{ name: asset, browser_download_url: base + '/download/v' + version + '/' + asset,
      size: Number(manifest.match(/^ +size: *(\d+)/m)?.[1]) || undefined }],
  };
}

export async function checkForAppUpdates(): Promise<UpdateInfo> {
  const currentVersion = APP_VERSION || app.getVersion();

  try {
    const url = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest/download/latest.yml`;
    const release = publicRelease(await fetchManifest(url));

    if (!release.tag_name) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: currentVersion,
        releaseName: 'Versão mais recente',
        releaseNotes: 'O SpaceViewer já está atualizado com a versão mais recente.',
        releaseDate: new Date().toISOString(),
      };
    }

    const latestVersion = release.tag_name.replace(/^v/i, '').trim();
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    // Find .exe asset for Windows
    let downloadUrl: string | undefined;
    let assetName: string | undefined;
    let assetSize: number | undefined;

    if (Array.isArray(release.assets)) {
      const exeAsset = release.assets.find((a: any) =>
        typeof a.name === 'string' && a.name.toLowerCase().endsWith('.exe')
      );
      if (exeAsset) {
        downloadUrl = exeAsset.browser_download_url;
        assetName = exeAsset.name;
        assetSize = exeAsset.size;
      }
    }

    return {
      updateAvailable: hasUpdate,
      currentVersion,
      latestVersion,
      releaseName: release.name || release.tag_name,
      releaseNotes: release.body || 'Sem notas de lançamento disponíveis.',
      releaseDate: release.published_at || new Date().toISOString(),
      downloadUrl,
      assetName,
      assetSize,
      htmlUrl: release.html_url,
    };
  } catch (err: any) {
    console.error('[Updater] Erro ao verificar atualizações:', err);
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      releaseName: 'Erro ao verificar',
      releaseNotes: '',
      releaseDate: '',
      error: err.message || 'Não foi possível conectar ao servidor de atualizações.',
    };
  }
}

function downloadFileWithRedirects(
  targetUrl: string,
  destPath: string,
  onProgress: (p: DownloadProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    let startTime = Date.now();
    let transferred = 0;

    function handleRequest(urlStr: string) {
      const parsedUrl = new URL(urlStr);
      const client = parsedUrl.protocol === 'http:' ? http : https;

      const req = client.get(
        urlStr,
        {
          headers: {
            'User-Agent': 'SpaceViewer-App',
            'Accept': 'application/octet-stream',
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return handleRequest(res.headers.location);
          }

          if (res.statusCode !== 200) {
            return reject(new Error(`Falha no download (HTTP ${res.statusCode})`));
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          const fileStream = fs.createWriteStream(destPath);

          let lastTime = startTime;
          let lastTransferred = 0;

          res.on('data', (chunk) => {
            transferred += chunk.length;
            const now = Date.now();
            const timeDiff = (now - lastTime) / 1000;
            let speed = 0;
            if (timeDiff >= 0.5) {
              speed = (transferred - lastTransferred) / timeDiff;
              lastTime = now;
              lastTransferred = transferred;
            }

            const percent = total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 0;
            onProgress({ percent, transferred, total, speed });
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close(() => {
              onProgress({ percent: 100, transferred, total: transferred, speed: 0 });
              resolve();
            });
          });

          fileStream.on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
          });
        }
      );

      req.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }

    handleRequest(targetUrl);
  });
}

export async function downloadAndInstallUpdate(
  downloadUrl: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    const tempDir = app.getPath('temp');
    const installerFile = path.join(tempDir, `SpaceViewer-Update-Setup.exe`);

    // Remove old update file if exists
    if (fs.existsSync(installerFile)) {
      try {
        fs.unlinkSync(installerFile);
      } catch (_) {}
    }

    console.log(`[Updater] Baixando atualização de ${downloadUrl} para ${installerFile}`);

    await downloadFileWithRedirects(downloadUrl, installerFile, (p) => {
      if (onProgress) onProgress(p);
    });

    console.log('[Updater] Download concluído! Arquivo do instalador pronto para aplicação.');
    return { success: true };
  } catch (err: any) {
    console.error('[Updater] Erro ao baixar atualização:', err);
    return { success: false, error: err.message || 'Falha ao baixar atualização' };
  }
}

export async function applyUpdateAndRestart(): Promise<{ success: boolean; error?: string }> {
  try {
    const tempDir = app.getPath('temp');
    const installerFile = path.join(tempDir, `SpaceViewer-Update-Setup.exe`);

    if (!fs.existsSync(installerFile)) {
      return { success: false, error: 'Arquivo do instalador não encontrado.' };
    }

    console.log(`[Updater] Preparando script de reinício e execução do instalador: ${installerFile}`);

    const batFile = path.join(tempDir, 'spaceviewer_apply_update.bat');
    const escapedInstaller = installerFile.replace(/"/g, '');

    const batContent = `@echo off
setlocal
echo [SpaceViewer] Aguardando encerramento do aplicativo...
timeout /t 2 /nobreak >nul
taskkill /F /IM SpaceViewer.exe >nul 2>&1
taskkill /F /IM SpaceviwerStream.exe >nul 2>&1
taskkill /F /IM SpaceviwerStreamDisplayCtl.exe >nul 2>&1

echo [SpaceViewer] Executando instalador da nova versao com elevacao de Administrador...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '${escapedInstaller}' -Verb RunAs -Wait"

echo [SpaceViewer] Instalacao concluida! Reiniciando SpaceViewer...
timeout /t 1 /nobreak >nul
if exist "%LOCALAPPDATA%\\Programs\\SpaceViewer\\SpaceViewer.exe" (
    start "" "%LOCALAPPDATA%\\Programs\\SpaceViewer\\SpaceViewer.exe"
    exit
)
if exist "C:\\Program Files\\SpaceViewer\\SpaceViewer.exe" (
    start "" "C:\\Program Files\\SpaceViewer\\SpaceViewer.exe"
    exit
)
if exist "%PROGRAMFILES%\\SpaceViewer\\SpaceViewer.exe" (
    start "" "%PROGRAMFILES%\\SpaceViewer\\SpaceViewer.exe"
    exit
)
exit
`;
    fs.writeFileSync(batFile, batContent, 'utf-8');

    // Spawn the batch launcher detached
    const child = spawn('cmd.exe', ['/c', batFile], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    // Exit app cleanly after 600ms so batch script can take over
    setTimeout(() => {
      app.exit(0);
    }, 600);

    return { success: true };
  } catch (err: any) {
    console.error('[Updater] Erro ao executar script de atualização:', err);
    return { success: false, error: err.message || 'Falha ao iniciar instalador.' };
  }
}
