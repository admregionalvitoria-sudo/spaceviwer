import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GlassCard } from './ui/GlassCard';
import type { NativeSession, NativeAudioStatus, HostDisplayInfo, AppWindowSource } from '../../shared/types';

/** Shared TV controls shown alongside monitor and Moonlight management. */
export function TVAssignments() {
  const [sessions, setSessions] = useState<NativeSession[]>([]);
  const [displays, setDisplays] = useState<HostDisplayInfo[]>([]);
  const [apps, setApps] = useState<AppWindowSource[]>([]);
  const [audio, setAudio] = useState<NativeAudioStatus>({ installed: false, redirected: false, error: '' });
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const polling = useRef(false);
  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const [clients, monitors, sound] = await Promise.all([
        window.screenflow.getNativeSessions(), window.screenflow.getHostDisplays(), window.screenflow.getNativeAudioStatus(),
      ]);
      if (mounted.current) { setSessions(clients); setDisplays(monitors); setAudio(sound); }
    } finally { polling.current = false; }
  }, []);
  const refreshApps = async () => { const windows = await window.screenflow.getAppWindows(); if (mounted.current) setApps(windows); };
  useEffect(() => {
    mounted.current = true;
    refresh().catch(console.error); refreshApps().catch(console.error);
    const timer = setInterval(() => refresh().catch(console.error), 2000);
    const unsubscribe = window.screenflow.onScreensChanged(() => refresh().catch(console.error));
    return () => { mounted.current = false; clearInterval(timer); unsubscribe(); };
  }, [refresh]);
  const run = async (key: string, work: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(key); setMessage('');
    try { const result = await work(); if (!result.success) throw new Error(result.error || 'Não foi possível aplicar.'); await refresh(); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(''); }
  };
  const monitorName = (display: HostDisplayInfo) => {
    const slot = displays.filter(item => item.virtual).findIndex(item => item.index === display.index);
    return display.virtual ? `Tela virtual ${slot + 1}` : `${display.primary ? 'PC principal' : display.name} (física)`;
  };
  return <GlassCard className="p-5 space-y-4 shrink-0 text-neutral-900">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-bold text-sm">Uma tela e um aplicativo para cada TV</h3>
        <p className="text-xs text-neutral-600 mt-1">Use telas estendidas para mostrar conteúdos diferentes e continuar usando o PC.</p></div>
      <button disabled={!!busy} className="border rounded-lg px-3 py-2 text-xs disabled:opacity-50"
        onClick={() => run('screens', async () => {
          const state = await window.screenflow.getVirtualDisplayState();
          const count = await window.screenflow.setVirtualDisplayCount(Math.min(4, Math.max(2, state.count || 0, sessions.length)));
          if (!count.success) return count;
          const mode = await window.screenflow.setDisplayMode('extended');
          if (!mode.success) return mode;
          const monitors = (await window.screenflow.getHostDisplays()).filter(item => item.virtual);
          const connections = await window.screenflow.getNativeSessions();
          for (let index=0; index<connections.length; index++) {
            if (!monitors[index]) return { success: false, error: 'O Windows ainda não disponibilizou todas as telas virtuais.' };
            const assignment = await window.screenflow.setNativeSessionDisplay(connections[index].address, monitors[index].index);
            if (!assignment.success) return assignment;
          }
          return { success: true };
        })}>Preparar duas telas virtuais</button>
    </div>
    {!sessions.length && <p className="text-xs text-neutral-500">Conecte as TVs pelo Moonlight. Cada conexão aparecerá aqui com sua tela e seu áudio.</p>}
    {sessions.map(session => <div key={session.address} className="border rounded-xl p-4 space-y-3 bg-white/60">
      <div className="flex justify-between gap-2"><strong className="text-xs">TV · {session.address}</strong>
        <span className="text-xs text-neutral-500">{session.display < 0 ? 'Aguardando a tela atribuída' : session.displayKey?.startsWith('virtual:') ? 'Área de trabalho independente' : 'Monitor físico'}</span></div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs space-y-1 block"><span>Tela desta TV</span>
          <select className="w-full rounded-lg border p-2 bg-white" aria-label={`Tela da TV ${session.address}`}
            value={session.display} disabled={!!busy} onChange={event => run(session.address, () => window.screenflow.setNativeSessionDisplay(session.address, Number(event.target.value)))}>
            {session.display < 0 && <option value={-1}>Tela indisponível — crie ou escolha uma tela</option>}
            {displays.map(display => <option key={display.index} value={display.index}>{monitorName(display)}</option>)}
          </select>
        </label>
        <label className="text-xs space-y-1 block"><span>Áudio exclusivo desta TV</span>
          <select className="w-full rounded-lg border p-2 bg-white" aria-label={`Áudio da TV ${session.address}`} disabled={!!busy || !audio.installed}
            value={session.audioWindow && session.audioWindow !== '0' ? `window:${session.audioWindow}:0` : 'none'}
            onFocus={() => refreshApps().catch(console.error)}
            onChange={event => run(session.address, () => window.screenflow.setNativeSessionAudio(session.address, event.target.value))}>
            <option value="none">Sem áudio</option>
            {session.audioWindow && session.audioWindow !== '0' && !apps.some(app => app.id.split(':')[1] === session.audioWindow) && <option value={`window:${session.audioWindow}:0`}>{session.audioName} (janela fechada)</option>}
            {apps.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}
          </select>
        </label>
      </div>
      {session.audioError && <p role="alert" className="text-xs text-red-700">{session.audioError}</p>}
    </div>)}
    <div className="text-xs text-neutral-600 space-y-2">
      {!audio.installed ? <><p>Para tocar somente nas TVs, instale o VB-CABLE, da VB-Audio. É donationware; o uso profissional requer licença do fornecedor.</p>
        <button disabled={!!busy} className="border rounded-lg px-3 py-2 text-neutral-900 disabled:opacity-50" onClick={() => run('audio', window.screenflow.installNativeAudio)}>{busy === 'audio' ? 'Instalando…' : 'Instalar saída de áudio VB-CABLE'}</button></>
        : <p>{audio.redirected ? 'Áudio direcionado às TVs. A saída normal do PC será restaurada quando as transmissões com áudio terminarem.' : 'Saída virtual pronta. Escolha o aplicativo de áudio em cada TV.'}</p>}
      <p>Use “Transmitir aplicativo” na tela virtual correspondente para escolher a imagem. Janelas ou abas que pertencem ao mesmo processo compartilham áudio; para separar, use aplicativos ou instâncias independentes.</p>
    </div>
    {(message || audio.error) && <p role="alert" className="text-xs text-amber-900 bg-amber-50 rounded-lg p-3">{message || audio.error}</p>}
  </GlassCard>;
}
