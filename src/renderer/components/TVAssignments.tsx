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
    return display.virtual ? 'Tela virtual (Espelhada no Moonlight)' : `${display.primary ? 'PC principal' : display.name} (física)`;
  };
  return <GlassCard className="p-5 space-y-4 shrink-0 text-neutral-900">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-bold text-sm">Espelhamento das TVs (Moonlight)</h3>
        <p className="text-xs text-neutral-600 mt-1">Todas as TVs conectadas exibem a mesma Tela Virtual, reduzindo o uso da GPU e o tráfego da rede.</p></div>
      <button disabled={!!busy} className="border rounded-lg px-3 py-2 text-xs font-mono font-bold uppercase disabled:opacity-50 hover:bg-neutral-100 transition cursor-pointer"
        onClick={() => run('screens', async () => {
          const state = await window.screenflow.getVirtualDisplayState();
          if (!state.enabled) {
            const enable = await window.screenflow.toggleVirtualDisplays(true);
            if (!enable.success) return enable;
          }
          const mode = await window.screenflow.setDisplayMode('extended');
          if (!mode.success) return mode;
          const monitors = await window.screenflow.getHostDisplays();
          const virtual = monitors.find(item => item.virtual) || monitors[0];
          if (virtual) {
            const connections = await window.screenflow.getNativeSessions();
            for (const connection of connections) {
              const assignment = await window.screenflow.setNativeSessionDisplay(connection.address, virtual.index);
              if (!assignment.success) return assignment;
            }
          }
          return { success: true };
        })}>Sincronizar Espelhamento</button>
    </div>
    <div className="text-xs space-y-2">
      <button disabled={!!busy || !sessions.length || !audio.installed} className="rounded-lg px-3 py-2 bg-neutral-900 text-white disabled:opacity-50"
        onClick={() => run('shared-audio', async () => {
          for (const session of sessions) {
            const result = await window.screenflow.setNativeSessionAudio(session.address, 'system');
            if (!result.success) return result;
          }
          return { success: true };
        })}>Mesmo áudio em todas as TVs</button>
      <p className="text-neutral-600">O modo compartilhado envia o som do Windows para todas as TVs ativadas em perfeita sincronia com o vídeo espelhado.</p>
    </div>
    {!sessions.length && <p className="text-xs text-neutral-500">Conecte as TVs pelo Moonlight. Todas as conexões exibirão a mesma tela virtual automaticamente.</p>}
    {sessions.map(session => <div key={session.address} className="border rounded-xl p-4 space-y-3 bg-white/60">
      <div className="flex justify-between gap-2"><strong className="text-xs">TV · {session.address}</strong>
        <span className="text-xs text-neutral-500">{session.display < 0 ? 'Aguardando a tela atribuída' : 'Espelhamento Unificado'}</span></div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs space-y-1 block"><span>Tela transmitida (espelhada para todas as TVs)</span>
          <select className="w-full rounded-lg border p-2 bg-white" aria-label={`Tela da TV ${session.address}`}
            value={session.display} disabled={!!busy} onChange={event => run('change-screen-all', async () => {
              const targetDisplay = Number(event.target.value);
              for (const s of sessions) {
                await window.screenflow.setNativeSessionDisplay(s.address, targetDisplay);
              }
              return { success: true };
            })}>
            {session.display < 0 && <option value={-1}>Tela indisponível — crie ou escolha uma tela</option>}
            {displays.map(display => <option key={display.index} value={display.index}>{monitorName(display)}</option>)}
          </select>
        </label>
        <label className="text-xs space-y-1 block"><span>Áudio desta TV</span>
          <select className="w-full rounded-lg border p-2 bg-white" aria-label={`Áudio da TV ${session.address}`} disabled={!!busy || !audio.installed}
            value={session.audioMode === 'system' ? 'system' : session.audioWindow && session.audioWindow !== '0' ? `window:${session.audioWindow}:0` : 'none'}
            onFocus={() => refreshApps().catch(console.error)}
            onChange={event => run(session.address, () => window.screenflow.setNativeSessionAudio(session.address, event.target.value))}>
            <option value="none">Sem áudio</option>
            <option value="system">Som do Windows (compartilhado)</option>
            {session.audioWindow && session.audioWindow !== '0' && !apps.some(app => app.id.split(':')[1] === session.audioWindow) && <option value={`window:${session.audioWindow}:0`}>{session.audioName} (janela fechada)</option>}
            {apps.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-neutral-600">{session.audioMode === 'none' ? 'Áudio desativado nesta TV.' : !session.audioPackets ? 'Aguardando o Moonlight iniciar a recepção de áudio.' : `${session.audioPackets} pacotes enviados · ${(session.audioPeak || 0) > 0 ? 'Som detectado' : 'Sem sinal de áudio na captura'}`}</p>
      {session.audioError && <p role="alert" className="text-xs text-red-700">{session.audioError}</p>}
    </div>)}
    <div className="text-xs text-neutral-600 space-y-2">
      {!audio.installed ? <><p>Para tocar somente nas TVs, instale o VB-CABLE, da VB-Audio. É donationware; o uso profissional requer licença do fornecedor.</p>
        <button disabled={!!busy} className="border rounded-lg px-3 py-2 text-neutral-900 disabled:opacity-50" onClick={() => run('audio', window.screenflow.installNativeAudio)}>{busy === 'audio' ? 'Instalando…' : 'Instalar saída de áudio VB-CABLE'}</button></>
        : <p>{audio.redirected ? 'Saída virtual ativada. A saída normal do PC será restaurada quando as transmissões com áudio terminarem.' : 'Saída virtual pronta. Ative o som compartilhado nas TVs.'}</p>}
      <p>Use “Transmitir aplicativo” na tela virtual correspondente para escolher a imagem. Janelas ou abas que pertencem ao mesmo processo compartilham áudio; para separar, use aplicativos ou instâncias independentes.</p>
    </div>
    {(message || audio.error) && <p role="alert" className="text-xs text-amber-900 bg-amber-50 rounded-lg p-3">{message || audio.error}</p>}
  </GlassCard>;
}
