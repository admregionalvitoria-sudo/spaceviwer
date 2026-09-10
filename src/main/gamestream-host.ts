import { spawn, execFile, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import { app, screen } from 'electron';
import { changeVirtualDisplays, getWindowsDisplayInventory, matchWindowsDisplay, invalidateDisplayInventory } from './windows-displays';
import { runPowerShell, psLiteral } from './windows-powershell';
import type { NativeSession, NativeAudioStatus, SunshineStatus, DisplayTopologyMode, HostDisplayInfo, HostSettings, VirtualDisplayState, VirtualDisplayStatus, MoonlightClient, SunshineStreamStats, SunshineConfig, ScreenSource } from '../shared/types';

let hostProcess: ChildProcess | null = null;
let starting: Promise<boolean> | null = null;
let stopping: Promise<void> | null = null;
let pairingTimer: NodeJS.Timeout | null = null;
let pairingWaiting = false;
let operations: Promise<unknown> = Promise.resolve();
let settingsQueue: Promise<unknown> = Promise.resolve();
let statsPrevious: { time: number; frames: number; bytes: number } | undefined;

function resourceFile(file: string): string {
  const candidates = [
    ...(app.isPackaged ? [path.join(process.resourcesPath, 'spaceviwerstream', file)] : []),
    path.join(app.getAppPath(), 'resources', 'spaceviwerstream', file),
    path.join(process.cwd(), 'resources', 'spaceviwerstream', file),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}
export const getSpaceviwerStreamExePath = () => resourceFile('SpaceviwerStream.exe');
export const getDisplayCtlExePath = () => resourceFile('SpaceviwerStreamDisplayCtl.exe');
export const getVirtualDisplayInfPath = () => resourceFile(path.join('driver', 'virtual-display', 'MttVDD.inf'));

type Response = { status: number; data: any; raw: string };
function request(method: 'GET' | 'POST', endpoint: string, body?: Record<string, string | number | boolean>): Promise<Response> {
  return new Promise((resolve) => {
    const encoded = body ? new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)])).toString() : undefined;
    const req = http.request({ hostname: '127.0.0.1', port: 47990, path: endpoint, method, timeout: 15000,
      headers: encoded === undefined ? undefined : { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(encoded) },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => { let data: any = null; try { data = JSON.parse(raw); } catch {} resolve({ status: res.statusCode || 0, data, raw }); });
    });
    req.on('error', (error) => resolve({ status: 0, data: null, raw: error.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: null, raw: 'O servidor não respondeu a tempo.' }); });
    if (encoded !== undefined) req.write(encoded);
    req.end();
  });
}

async function nativeStatus(): Promise<Response> {
  const status = await request('GET', '/api/status');
  if (status.status === 200 && (status.data?.hostType !== 'SpaceViewer' || status.data?.apiVersion !== 2)) {
    return { status: 409, data: null, raw: 'Outro transmissor ou uma versão antiga está usando as portas do Moonlight. Encerre o SenaiStream/Sunshine e inicie o host do SpaceViewer.' };
  }
  return status;
}
async function nativeRequest(method: 'GET' | 'POST', endpoint: string, body?: Record<string, string | number | boolean>) {
  const status = await nativeStatus();
  return status.status === 200 ? request(method, endpoint, body) : status;
}
function result(response: Response) { return { success: response.status === 200, ...(response.status !== 200 ? { error: response.raw || 'O host está parado.' } : {}) }; }

export async function checkHostStatus(): Promise<SunshineStatus> {
  if (!fs.existsSync(getSpaceviwerStreamExePath())) return 'not_installed';
  return (await nativeStatus()).status === 200 ? 'running' : 'stopped';
}
export function startHost(): Promise<boolean> {
  if (starting) return starting;
  starting = (async () => {
    if (stopping) await stopping;
    const status = await nativeStatus();
    if (status.status === 200) return true;
    if (status.status === 409) throw new Error(status.raw);
    if (hostProcess && !hostProcess.killed) throw new Error('O servidor já está iniciando.');
    const executable = getSpaceviwerStreamExePath();
    if (!fs.existsSync(executable)) throw new Error('Servidor nativo não encontrado. Compile o projeto ou reinstale o aplicativo.');
    const child = spawn(executable, ['--host'], { cwd: path.dirname(executable), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    hostProcess = child;
    let diagnostic = '';
    child.stdout?.on('data', (data) => console.log('[SpaceViewer Host]', data.toString().trim()));
    child.stderr?.on('data', (data) => { diagnostic = data.toString().trim(); console.warn('[SpaceViewer Host]', diagnostic); });
    child.on('error', (error) => { diagnostic = error.message; });
    child.on('exit', () => { if (hostProcess === child) hostProcess = null; });
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if ((await nativeStatus()).status === 200) return true;
      if (child.exitCode !== null || !hostProcess) break;
    }
    child.kill();
    throw new Error(diagnostic || 'Não foi possível iniciar o servidor. Verifique se outro transmissor está usando as portas.');
  })().finally(() => { starting = null; });
  return starting;
}
export function stopHost(): Promise<void> {
  if (stopping) return stopping;
  stopping = (async () => {
  if (starting) await starting.catch(() => {});
  const shutdown = await nativeRequest('POST', '/api/shutdown', {});
  if (shutdown.status === 200) {
    for (let i=0;i<30;i++) {
      if ((await nativeStatus()).status !== 200) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  if (hostProcess) { hostProcess.kill(); hostProcess = null; }
  await runPowerShell(`Get-CimInstance Win32_Process -Filter "Name='SpaceviwerStream.exe'" | Where-Object { $_.ExecutablePath -eq ${psLiteral(getSpaceviwerStreamExePath())} } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction Stop }`);
  await new Promise<void>((resolve, reject) => execFile(getSpaceviwerStreamExePath(), ['--restore-audio'], { windowsHide: true, timeout: 10000 }, error => error ? reject(error) : resolve()));
  })().finally(() => { stopping = null; });
  return stopping;
}
export async function restartHost() { await stopHost(); return startHost(); }
export function isHostRunning() { return hostProcess !== null && !hostProcess.killed; }

function queue<T>(work: () => Promise<T>): Promise<T> { const next = operations.then(work); operations = next.catch(() => {}); return next; }
export async function getVirtualDisplayState(): Promise<VirtualDisplayState> {
  const { installed, active, enabled, count } = await getWindowsDisplayInventory();
  return { installed, active, enabled, count };
}
export async function getVirtualDisplayStatus(): Promise<VirtualDisplayStatus> { return getVirtualDisplayState(); }
export async function refreshHostCapture() {
  invalidateDisplayInventory();
  return result(await nativeRequest('POST', '/api/refresh-capture', {}));
}
async function applyCount(count: number) {
  if (!Number.isInteger(count) || count < 0 || count > 4) return { success: false, count: (await getVirtualDisplayState()).count, error: 'Escolha de 0 a 4 telas virtuais.' };
  const changed = await changeVirtualDisplays(count === 0 ? 'disable' : 'set-count', Math.max(1, count));
  if (changed.success) await refreshHostCapture();
  return { ...changed, count: (await getVirtualDisplayState()).count };
}
export function setVirtualDisplayCount(count: number) { return queue(() => applyCount(count)); }
export function addVirtualDisplay() { return queue(async () => applyCount((await getVirtualDisplayState()).count + 1)); }
export function removeVirtualDisplay() { return queue(async () => applyCount(Math.max(0, (await getVirtualDisplayState()).count - 1))); }
export function toggleVirtualDisplays(enabled: boolean) { return queue(async () => { const res = await changeVirtualDisplays(enabled ? 'enable' : 'disable'); if (res.success) await refreshHostCapture(); return res; }); }
export function installVirtualDisplayDriver() { return queue(async () => { const res = await changeVirtualDisplays('install'); if (res.success) await refreshHostCapture(); return res; }); }
export function removeVirtualDisplayDriver() { return queue(async () => { const res = await changeVirtualDisplays('remove'); if (res.success) await refreshHostCapture(); return res; }); }
export function setDisplayMode(mode: DisplayTopologyMode) {
  return queue(async () => {
    if (mode !== 'extended' && mode !== 'duplicate') return { success: false, error: 'Modo de tela inválido.' };
    const status = await nativeStatus();
    if (status.status === 200) { const response = await request('POST', '/api/display-mode', { mode: mode === 'extended' ? 'extend' : 'duplicate' }); invalidateDisplayInventory(); return result(response); }
    if (status.status === 409) return result(status);
    try { await runPowerShell(`& ${psLiteral(getDisplayCtlExePath())} ${mode === 'extended' ? 'extend' : 'duplicate'}\nexit $LASTEXITCODE`); invalidateDisplayInventory(); return { success: true }; }
    catch (error) { return { success: false, error: (error as Error).message }; }
  });
}
export async function getHostDisplays(): Promise<HostDisplayInfo[]> {
  const response = await nativeRequest('GET', '/api/displays');
  if (response.status === 200 && Array.isArray(response.data?.displays)) return response.data.displays.map((d: any) => ({ index: d.index, name: d.name, deviceName: d.deviceName, width: d.width, height: d.height, primary: Boolean(d.primary), virtual: Boolean(d.virtual) }));
  return (await getWindowsDisplayInventory()).displays.map((d, index) => ({ index, name: d.label, deviceName: d.deviceName, width: d.width, height: d.height, primary: d.primary, virtual: d.isVirtual }));
}
const defaultSettings: HostSettings = { display: 0, width: 0, height: 0, fps: 60, bitrateMbps: 20, hardware: true, virtualDisplay: false };
export async function getHostSettings(): Promise<HostSettings> {
  const response = await nativeRequest('GET', '/api/settings');
  return response.status === 200 && response.data ? { ...defaultSettings, ...response.data } : { ...defaultSettings };
}
export function setHostSettings(settings: Partial<HostSettings>) {
  const next = settingsQueue.then(async () => {
    const merged = { ...await getHostSettings(), ...settings };
    return result(await nativeRequest('POST', '/api/settings', { ...merged, hardware: merged.hardware ? 1 : 0, virtualDisplay: merged.virtualDisplay ? 1 : 0 }));
  });
  settingsQueue = next.catch(() => {});
  return next;
}
export async function setMoonlightScreen(sourceId: string, sources: ScreenSource[] = []) {
  const source = sources.find((s) => s.id === sourceId && s.id.startsWith('screen:'));
  const display = screen.getAllDisplays().find((d) => String(d.id) === source?.displayId);
  if (!display) return { success: false, error: 'A tela selecionada não está mais disponível.' };
  const native = matchWindowsDisplay(display, (await getWindowsDisplayInventory()).displays);
  const target = native && (await getHostDisplays()).find((d) => d.deviceName.toLowerCase() === native.deviceName.toLowerCase());
  if (!target) return { success: false, error: 'O servidor ainda não reconheceu esta tela.' };
  return setHostSettings({ display: target.index, virtualDisplay: target.virtual });
}
export async function pairMoonlightPin(pin: string) {
  if (!/^\d{4}$/.test(pin.trim())) return { success: false, error: 'Informe os quatro dígitos exibidos na TV.' };
  return result(await nativeRequest('POST', '/api/pin', { pin: pin.trim() }));
}
export async function getMoonlightClients(): Promise<MoonlightClient[]> {
  const response = await nativeRequest('GET', '/api/clients');
  return response.status === 200 && Array.isArray(response.data?.clients) ? response.data.clients : [];
}
export async function removeMoonlightClient(uuid: string) { return result(await nativeRequest('POST', '/api/clients/remove', { uuid })); }
export async function getStreamStats(): Promise<SunshineStreamStats> {
  const response = await nativeStatus();
  const status = response.status === 200 ? response.data : {};
  const now = Date.now(), previous = statsPrevious;
  statsPrevious = { time: now, frames: Number(status.frames || 0), bytes: Number(status.bytes || 0) };
  const seconds = previous ? Math.max(.001, (now - previous.time) / 1000) : 1;
  const clients = Number(status.activeClients || 0);
  return { isStreaming: clients > 0, activeClients: clients,
    fps: previous && clients ? Math.round(Math.max(0, statsPrevious.frames - previous.frames) / seconds / clients) : 0,
    bitrate: previous && clients ? Math.round(Math.max(0, statsPrevious.bytes - previous.bytes) * 8 / seconds / 1000) : 0,
    resolution: { width: Number(status.width || 0), height: Number(status.height || 0) },
    uptime: Number(status.uptime || 0), encoder: 'Media Foundation H.264', displayMode: status.displayMode === 'extended' ? 'extended' : 'duplicate' };
}
export function startPairingWatcher(callback: (info: { name?: string }) => void) {
  if (pairingTimer) return;
  let polling = false;
  pairingTimer = setInterval(async () => { if (polling) return; polling = true; try {
    const response = await nativeStatus(); const waiting = response.status === 200 && Boolean(response.data?.pairingWaiting);
    if (waiting && !pairingWaiting) callback({ name: 'Smart TV / Moonlight' }); pairingWaiting = waiting;
  } finally { polling = false; } }, 1000);
}
export function stopPairingWatcher() { if (pairingTimer) clearInterval(pairingTimer); pairingTimer = null; pairingWaiting = false; }
// Retained IPC aliases keep existing renderer callers compatible; no Sunshine runtime is used.
export async function getSunshineConfig(): Promise<SunshineConfig> { const s = await getHostSettings(); return { displayName: `SpaceViewer - ${os.hostname()}`, captureDisplayIndex: s.display, selectedSourceId: null, fps: s.fps, resolution: { width: s.width, height: s.height } }; }
export async function setSunshineConfig(config: Partial<SunshineConfig>) { const updates: Partial<HostSettings> = {}; if (config.captureDisplayIndex !== undefined) updates.display = config.captureDisplayIndex; if (config.fps !== undefined) updates.fps = config.fps; if (config.resolution) { updates.width = config.resolution.width; updates.height = config.resolution.height; } return setHostSettings(updates); }

export async function getNativeSessions(): Promise<NativeSession[]> { const res = await nativeRequest('GET', '/api/sessions'); return res.status === 200 ? res.data?.sessions || [] : []; }
export async function setNativeSessionDisplay(address: string, display: number) { return result(await nativeRequest('POST', '/api/session-display', { address, display })); }

export async function setNativeSessionAudio(address: string, sourceId: string) {
  const match = /^window:(\d+):/.exec(sourceId);
  if (sourceId !== 'none' && sourceId !== 'system' && !match) return { success: false, error: 'Selecione uma janela de aplicativo válida.' };
  return result(await nativeRequest('POST', '/api/session-audio', { address, window: match?.[1] || '0', mode: sourceId === 'system' ? 'system' : 'process' }));
}
export async function getNativeAudioStatus(): Promise<NativeAudioStatus> {
  const response = await nativeRequest('GET', '/api/audio-status');
  return response.status === 200 ? response.data : { installed: false, redirected: false, error: response.raw || 'Host indisponível.' };
}
export async function installNativeAudio() {
  try {
    await runPowerShell(`& ${psLiteral(resourceFile('install-audio.ps1'))}\nexit $LASTEXITCODE`, true);
    for (let i=0;i<10;i++) {
      if ((await getNativeAudioStatus()).installed) return { success: true };
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return { success: false, error: 'O driver foi instalado, mas o host ainda não encontrou a saída virtual. Reinicie o host.' };
  } catch (error) { return { success: false, error: (error as Error).message }; }
}

/** Associates a projected window with the TV using that exact monitor. */
export async function setProjectedApplicationAudio(sourceId: string, displayId: string) {
  const display = screen.getAllDisplays().find(item => String(item.id) === displayId);
  if (!display) return;
  const native = matchWindowsDisplay(display, (await getWindowsDisplayInventory()).displays);
  const target = native && (await getHostDisplays()).find(item => item.deviceName.toLowerCase() === native.deviceName.toLowerCase());
  if (!target || !(await getNativeAudioStatus()).installed) return;
  for (const session of await getNativeSessions()) if (session.display === target.index) {
    if (session.audioMode === 'system') continue;
    const changed = await setNativeSessionAudio(session.address, sourceId);
    if (!changed.success) throw new Error(changed.error);
  }
}
