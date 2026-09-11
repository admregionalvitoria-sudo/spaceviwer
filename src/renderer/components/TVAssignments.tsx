import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GlassCard } from './ui/GlassCard';
import type { NativeSession, NativeAudioStatus, HostDisplayInfo, AppWindowSource, HostSettings } from '../../shared/types';

/** Shared TV controls shown alongside monitor and Moonlight management. */
export function TVAssignments() {
  const [sessions, setSessions] = useState<NativeSession[]>([]);
  const [displays, setDisplays] = useState<HostDisplayInfo[]>([]);
  const [apps, setApps] = useState<AppWindowSource[]>([]);
  const [audio, setAudio] = useState<NativeAudioStatus>({ installed: false, redirected: false, error: '' });
  const [hostSettings, setHostSettingsState] = useState<HostSettings>({
    display: 0,
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateMbps: 40,
    hardware: true,
    virtualDisplay: true,
  });
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const polling = useRef(false);

  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const [clients, monitors, sound, settings] = await Promise.all([
        window.screenflow.getNativeSessions(),
        window.screenflow.getHostDisplays(),
        window.screenflow.getNativeAudioStatus(),
        window.screenflow.getHostSettings(),
      ]);
      if (mounted.current) {
        setSessions(clients);
        setDisplays(monitors);
        setAudio(sound);
        if (settings) setHostSettingsState(settings);
      }
    } finally {
      polling.current = false;
    }
  }, []);

  const refreshApps = async () => {
    const windows = await window.screenflow.getAppWindows();
    if (mounted.current) setApps(windows);
  };

  useEffect(() => {
    mounted.current = true;
    refresh().catch(console.error);
    refreshApps().catch(console.error);
    const timer = setInterval(() => refresh().catch(console.error), 2000);
    const unsubscribe = window.screenflow.onScreensChanged(() => refresh().catch(console.error));
    return () => {
      mounted.current = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, [refresh]);

  const run = async (key: string, work: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(key);
    setMessage('');
    try {
      const result = await work();
      if (!result.success) throw new Error(result.error || 'Não foi possível aplicar.');
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy('');
    }
  };

  const monitorName = (display: HostDisplayInfo) => {
    return display.virtual ? 'Tela virtual única (Moonlight)' : `${display.primary ? 'PC principal' : display.name} (física)`;
  };

  const updateQuality = async (updates: Partial<HostSettings>) => {
    await run('quality', async () => {
      const res = await window.screenflow.setHostSettings(updates);
      if (res.success) {
        setHostSettingsState((prev) => ({ ...prev, ...updates }));
      }
      return res;
    });
  };

  return (
    <GlassCard className="p-5 space-y-4 shrink-0 text-neutral-900">
      {/* Header & Main Sync Controls */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm flex items-center space-x-2">
            <span>Espelhamento das TVs (Moonlight)</span>
          </h3>
          <p className="text-xs text-neutral-600 mt-1 max-w-2xl">
            Todas as TVs conectadas exibem a mesma Tela Virtual em tempo real, reduzindo o uso da GPU e o tráfego da rede.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            disabled={!!busy}
            className="border border-neutral-300 rounded-lg px-3 py-2 text-xs font-mono font-bold uppercase disabled:opacity-50 hover:bg-neutral-100 transition cursor-pointer bg-white"
            onClick={() =>
              run('refresh-capture', async () => {
                return await window.screenflow.refreshHostCapture();
              })
            }
            title="Destrava a transmissão caso a imagem tenha congelado"
          >
            {busy === 'refresh-capture' ? 'Atualizando…' : 'Destravar Transmissão'}
          </button>
          <button
            disabled={!!busy}
            className="rounded-lg px-3 py-2 text-xs font-mono font-bold uppercase disabled:opacity-50 bg-neutral-900 text-white hover:bg-neutral-800 transition cursor-pointer"
            onClick={() =>
              run('screens', async () => {
                const state = await window.screenflow.getVirtualDisplayState();
                if (!state.enabled) {
                  const enable = await window.screenflow.toggleVirtualDisplays(true);
                  if (!enable.success) return enable;
                }
                const mode = await window.screenflow.setDisplayMode('extended');
                if (!mode.success) return mode;
                const monitors = await window.screenflow.getHostDisplays();
                const virtual = monitors.find((item) => item.virtual) || monitors[0];
                if (virtual) {
                  const connections = await window.screenflow.getNativeSessions();
                  for (const connection of connections) {
                    const assignment = await window.screenflow.setNativeSessionDisplay(connection.address, virtual.index);
                    if (!assignment.success) return assignment;
                  }
                }
                await window.screenflow.refreshHostCapture();
                return { success: true };
              })
            }
          >
            {busy === 'screens' ? 'Sincronizando…' : 'Sincronizar em Tempo Real'}
          </button>
        </div>
      </div>

      {/* Seletor de Qualidade e Resolução de Transmissão */}
      <div className="border border-neutral-250 rounded-xl p-4 space-y-3 bg-white/70">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <strong className="text-xs font-bold uppercase tracking-wide text-neutral-900">
              Qualidade e Resolução da Transmissão
            </strong>
            <p className="text-xs text-neutral-600 mt-0.5">
              Ajuste para acabar com imagens embaçadas na TV e garantir transmissão em alta definição.
            </p>
          </div>
          <span className="text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded-md bg-neutral-900 text-white">
            {hostSettings.width}×{hostSettings.height} · {hostSettings.bitrateMbps} Mbps · {hostSettings.fps} FPS
          </span>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <label className="text-xs space-y-1 block">
            <span className="font-semibold text-neutral-700">Resolução do Vídeo</span>
            <select
              className="w-full rounded-lg border p-2 bg-white text-xs font-medium cursor-pointer"
              disabled={!!busy}
              value={`${hostSettings.width}x${hostSettings.height}`}
              onChange={(e) => {
                const [w, h] = e.target.value.split('x').map(Number);
                updateQuality({ width: w, height: h });
              }}
            >
              <option value="1920x1080">1920 × 1080 (1080p Full HD - Recomendado)</option>
              <option value="2560x1440">2560 × 1440 (2K QHD - Nitidez Superior)</option>
              <option value="3840x2160">3840 × 2160 (4K Ultra HD)</option>
              <option value="1280x720">1280 × 720 (720p HD - Leve)</option>
            </select>
          </label>

          <label className="text-xs space-y-1 block">
            <span className="font-semibold text-neutral-700">Taxa de Bits (Nitidez)</span>
            <select
              className="w-full rounded-lg border p-2 bg-white text-xs font-medium cursor-pointer"
              disabled={!!busy}
              value={hostSettings.bitrateMbps}
              onChange={(e) => {
                const bitrate = Number(e.target.value);
                updateQuality({ bitrateMbps: bitrate });
              }}
            >
              <option value={20}>20 Mbps (Equilibrado)</option>
              <option value={40}>40 Mbps (Alta Nitidez / Padrão)</option>
              <option value={60}>60 Mbps (Ultra Nitidez)</option>
              <option value={80}>80 Mbps (Qualidade Máxima)</option>
            </select>
          </label>

          <label className="text-xs space-y-1 block">
            <span className="font-semibold text-neutral-700">Taxa de Quadros (Fluidez)</span>
            <select
              className="w-full rounded-lg border p-2 bg-white text-xs font-medium cursor-pointer"
              disabled={!!busy}
              value={hostSettings.fps}
              onChange={(e) => {
                const fps = Number(e.target.value);
                updateQuality({ fps });
              }}
            >
              <option value={60}>60 FPS (Tempo Real Fluido)</option>
              <option value={30}>30 FPS (Econômico)</option>
            </select>
          </label>
        </div>

        <p className="text-[11px] text-neutral-500">
          O padrão de 40 Mbps em 1080p 60 FPS elimina artefatos de compressão borrados na TV, mantendo a transmissão em tempo real.
        </p>
      </div>

      {/* Áudio Unificado */}
      <div className="text-xs space-y-2">
        <button
          disabled={!!busy || !sessions.length || !audio.installed}
          className="rounded-lg px-3 py-2 bg-neutral-900 text-white disabled:opacity-50 font-medium cursor-pointer hover:bg-neutral-800 transition"
          onClick={() =>
            run('shared-audio', async () => {
              for (const session of sessions) {
                const result = await window.screenflow.setNativeSessionAudio(session.address, 'system');
                if (!result.success) return result;
              }
              return { success: true };
            })
          }
        >
          Mesmo áudio em todas as TVs
        </button>
        <p className="text-neutral-600">
          O modo compartilhado envia o som do Windows para todas as TVs ativadas em perfeita sincronia com o vídeo espelhado.
        </p>
      </div>

      {!sessions.length && (
        <p className="text-xs text-neutral-500">
          Conecte as TVs pelo Moonlight. Todas as conexões exibirão a mesma tela virtual automaticamente.
        </p>
      )}

      {/* Lista de Sessões Ativas */}
      {sessions.map((session) => (
        <div key={session.address} className="border border-neutral-200 rounded-xl p-4 space-y-3 bg-white/60">
          <div className="flex justify-between gap-2">
            <strong className="text-xs font-mono font-bold">TV · {session.address}</strong>
            <span className="text-xs text-neutral-500">
              {session.display < 0 ? 'Aguardando a tela atribuída' : 'Espelhamento Unificado'}
            </span>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs space-y-1 block">
              <span>Tela transmitida (espelhada para todas as TVs)</span>
              <select
                className="w-full rounded-lg border p-2 bg-white"
                aria-label={`Tela da TV ${session.address}`}
                value={session.display}
                disabled={!!busy}
                onChange={(event) =>
                  run('change-screen-all', async () => {
                    const targetDisplay = Number(event.target.value);
                    for (const s of sessions) {
                      await window.screenflow.setNativeSessionDisplay(s.address, targetDisplay);
                    }
                    return { success: true };
                  })
                }
              >
                {session.display < 0 && <option value={-1}>Tela indisponível — crie ou escolha uma tela</option>}
                {displays.map((display) => (
                  <option key={display.index} value={display.index}>
                    {monitorName(display)}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs space-y-1 block">
              <span>Áudio desta TV</span>
              <select
                className="w-full rounded-lg border p-2 bg-white"
                aria-label={`Áudio da TV ${session.address}`}
                disabled={!!busy || !audio.installed}
                value={
                  session.audioMode === 'system'
                    ? 'system'
                    : session.audioWindow && session.audioWindow !== '0'
                    ? `window:${session.audioWindow}:0`
                    : 'none'
                }
                onFocus={() => refreshApps().catch(console.error)}
                onChange={(event) =>
                  run(session.address, () => window.screenflow.setNativeSessionAudio(session.address, event.target.value))
                }
              >
                <option value="none">Sem áudio</option>
                <option value="system">Som do Windows (compartilhado)</option>
                {session.audioWindow &&
                  session.audioWindow !== '0' &&
                  !apps.some((app) => app.id.split(':')[1] === session.audioWindow) && (
                    <option value={`window:${session.audioWindow}:0`}>{session.audioName} (janela fechada)</option>
                  )}
                {apps.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs text-neutral-600">
            {session.audioMode === 'none'
              ? 'Áudio desativado nesta TV.'
              : !session.audioPackets
              ? 'Aguardando o Moonlight iniciar a recepção de áudio.'
              : `${session.audioPackets} pacotes enviados · ${(session.audioPeak || 0) > 0 ? 'Som detectado' : 'Sem sinal de áudio na captura'}`}
          </p>
          {session.audioError && (
            <p role="alert" className="text-xs text-red-700">
              {session.audioError}
            </p>
          )}
        </div>
      ))}

      <div className="text-xs text-neutral-600 space-y-2">
        {!audio.installed ? (
          <>
            <p>Para tocar somente nas TVs, instale o VB-CABLE, da VB-Audio. É donationware; o uso profissional requer licença do fornecedor.</p>
            <button
              disabled={!!busy}
              className="border rounded-lg px-3 py-2 text-neutral-900 disabled:opacity-50 hover:bg-neutral-100 transition cursor-pointer"
              onClick={() => run('audio', window.screenflow.installNativeAudio)}
            >
              {busy === 'audio' ? 'Instalando…' : 'Instalar saída de áudio VB-CABLE'}
            </button>
          </>
        ) : (
          <p>
            {audio.redirected
              ? 'Saída virtual ativada. A saída normal do PC será restaurada quando as transmissões com áudio terminarem.'
              : 'Saída virtual pronta. Ative o som compartilhado nas TVs.'}
          </p>
        )}
        <p>
          Use “Transmitir aplicativo” na tela virtual correspondente para escolher a imagem. Janelas ou abas que pertencem ao mesmo processo compartilham áudio; para separar, use aplicativos ou instâncias independentes.
        </p>
      </div>

      {(message || audio.error) && (
        <p role="alert" className="text-xs text-amber-900 bg-amber-50 rounded-lg p-3">
          {message || audio.error}
        </p>
      )}
    </GlassCard>
  );
}
