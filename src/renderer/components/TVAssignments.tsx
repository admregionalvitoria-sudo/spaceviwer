import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GlassCard } from './ui/GlassCard';
import type { NativeSession, HostDisplayInfo, HostSettings, NativeAudioStatus } from '../../shared/types';

/** Shared TV controls shown alongside monitor and Moonlight management. */
export function TVAssignments() {
  const [sessions, setSessions] = useState<NativeSession[]>([]);
  const [displays, setDisplays] = useState<HostDisplayInfo[]>([]);
  const [audioStatus, setAudioStatus] = useState<NativeAudioStatus>({
    installed: false,
    redirected: false,
    error: '',
  });
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
      const [clients, monitors, settings, audio] = await Promise.all([
        window.screenflow.getNativeSessions(),
        window.screenflow.getHostDisplays(),
        window.screenflow.getHostSettings(),
        window.screenflow.getNativeAudioStatus(),
      ]);
      if (mounted.current) {
        setSessions(Array.isArray(clients) ? clients : []);
        setDisplays(Array.isArray(monitors) ? monitors : []);
        if (settings) setHostSettingsState(settings);
        if (audio) setAudioStatus(audio);
      }
    } finally {
      polling.current = false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh().catch(console.error);
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

  const monitorName = (display?: HostDisplayInfo) => {
    if (!display) return 'Monitor desconhecido';
    return display.virtual ? 'Tela virtual única (Moonlight)' : `${display.primary ? 'PC principal' : display.name || 'Monitor'} (física)`;
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
            Todas as TVs conectadas exibem a mesma Tela Virtual e transmitem o som do Windows automaticamente em tempo real.
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
          Em Wi-Fi, comece com 20 Mbps em 1080p; aumente gradualmente se a imagem precisar de mais nitidez e a conexão continuar estável.
        </p>
      </div>

      {/* Status do Driver de Áudio Virtual & Sincronização */}
      {!audioStatus.installed ? (
        <div className="border border-amber-300 bg-amber-50 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-950">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="text-base">⚠️</span>
              <strong className="text-xs font-bold uppercase tracking-wide">
                Driver de Áudio Virtual Necessário para as TVs
              </strong>
            </div>
            <p className="text-xs text-amber-800">
              Para sair o áudio sincronizado com a imagem na TV pelo Moonlight, instale o driver de áudio virtual (VB-CABLE).
              O VB-CABLE é um software da VB-Audio distribuído como donationware; contribuições são bem-vindas e o uso profissional requer licença.{' '}
              <a className="font-semibold underline" href="https://vb-audio.com/Services/licensing.htm" target="_blank" rel="noreferrer">Licença e origem oficial</a>.
            </p>
          </div>
          <button
            disabled={!!busy}
            onClick={() =>
              run('install-audio', async () => {
                const res = await window.screenflow.installNativeAudio();
                if (!res.success) {
                  return { success: false, error: res.error || 'Falha ao instalar driver de áudio. Execute INSTALAR_DRIVER_AUDIO.bat como Administrador.' };
                }
                return { success: true };
              })
            }
            className="shrink-0 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-sm"
          >
            {busy === 'install-audio' ? 'Instalando Driver…' : 'Instalar Driver de Áudio (1 Clique)'}
          </button>
        </div>
      ) : (
        <div className="border border-emerald-200 bg-emerald-50/70 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs text-emerald-900">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
            <span className="font-semibold">Áudio Virtual Ativo — Som do Windows Sincronizado para as TVs</span>
          </div>
          <span className="font-mono text-[11px] text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded font-medium">
            {audioStatus.redirected ? 'Redirecionando áudio para TVs' : 'WASAPI Loopback Pronto'}
          </span>
        </div>
      )}

      {!(sessions?.length) && (
        <p className="text-xs text-neutral-500">
          Conecte as TVs pelo Moonlight. Todas as conexões exibirão a mesma tela virtual e reproduzirão o áudio do Windows automaticamente.
        </p>
      )}

      {/* Lista de Sessões Ativas */}
      {(sessions || []).map((session) => (
        <div key={session.address} className="border border-neutral-200 rounded-xl p-4 space-y-3 bg-white/60">
          <div className="flex justify-between gap-2 items-center">
            <strong className="text-xs font-mono font-bold">TV · {session.address}</strong>
            <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
              {session.display < 0 ? 'Aguardando tela' : 'Espelhamento & Áudio Sincronizado'}
            </span>
          </div>

          <div>
            <label className="text-xs space-y-1 block">
              <span>Tela transmitida (espelhada para todas as TVs)</span>
              <select
                className="w-full rounded-lg border p-2 bg-white text-xs"
                aria-label={`Tela da TV ${session.address}`}
                value={session.display}
                disabled={!!busy}
                onChange={(event) =>
                  run('change-screen-all', async () => {
                    const targetDisplay = Number(event.target.value);
                    for (const s of (sessions || [])) {
                      await window.screenflow.setNativeSessionDisplay(s.address, targetDisplay);
                    }
                    return { success: true };
                  })
                }
              >
                {session.display < 0 && <option value={-1}>Tela indisponível — crie ou escolha uma tela</option>}
                {(displays || []).map((display) => (
                  <option key={display.index} value={display.index}>
                    {monitorName(display)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {session.audioError && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
              ⚠️ Problema no áudio da TV: {session.audioError}
            </p>
          )}

          <div className="flex items-center justify-between text-xs text-neutral-600">
            <span>Áudio do Windows unificado e sincronizado em tempo real para esta TV.</span>
            {(session.audioPackets ?? 0) > 0 && (
              <span className="font-mono text-[10px] text-neutral-500">
                {session.audioPackets} pacotes Opus
              </span>
            )}
          </div>
        </div>
      ))}

      {message && (
        <p role="alert" className="text-xs text-amber-900 bg-amber-50 rounded-lg p-3">
          {message}
        </p>
      )}
    </GlassCard>
  );
}
