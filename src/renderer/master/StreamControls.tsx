import React, { useEffect } from 'react';
import { useMasterStore } from '../stores/masterStore';
import { GlassCard } from '../components/ui/GlassCard';
import { Toggle } from '../components/ui/Toggle';
import { SUPPORTED_CODECS, SUPPORTED_FPS, SUPPORTED_RESOLUTIONS } from '../../shared/constants';
import type { VideoCodec, AudioSource, TransmissionMode } from '../../shared/types';

interface StreamControlsProps {
  onStartStream: () => void;
  onStopStream: () => void;
  onPauseStream: () => void;
}

export const StreamControls: React.FC<StreamControlsProps> = ({
  onStartStream,
  onStopStream,
  onPauseStream,
}) => {
  const {
    screens,
    selectedScreen,
    streamConfig,
    streamStatus,
    loadScreens,
    selectScreen,
    setStreamConfig,
    selectedAgentId,
    setSelectedAgentId,
    agentScreens,
    setAgentScreen,
    connectedAgents,
    pendingRequests,
    removePendingRequest,
  } = useMasterStore();

  useEffect(() => {
    loadScreens();
  }, []);

  const selectedAgent = connectedAgents.find((a) => a.id === selectedAgentId);
  const activeScreenId = selectedAgentId
    ? agentScreens[selectedAgentId] || selectedScreen?.id || ''
    : selectedScreen?.id || '';
  const activeScreen = screens.find((s) => s.id === activeScreenId) || selectedScreen;

  const requestedScreenId = selectedAgentId ? pendingRequests[selectedAgentId] : null;
  const requestedScreen = requestedScreenId ? screens.find((s) => s.id === requestedScreenId) : null;

  return (
    <GlassCard className="h-full flex flex-col justify-between p-5 space-y-4 overflow-hidden">
      <div className="flex-1 overflow-y-auto space-y-4 pr-1.5">
        {/* Selected Agent Header */}
        {selectedAgent && (
          <div className="bg-neutral-100 border border-neutral-200 rounded-xl p-3 mb-2 flex items-center justify-between">
            <div className="min-w-0 flex-1 pr-2 font-mono">
              <span className="text-[9px] uppercase text-neutral-500 font-bold block">Configurando Destino</span>
              <span className="text-xs font-bold text-neutral-900 truncate block font-sans mt-0.5">{selectedAgent.name}</span>
            </div>
            <button
              onClick={() => setSelectedAgentId(null)}
              className="text-[9px] uppercase font-mono bg-neutral-250 border border-neutral-350/50 px-2.5 py-1 rounded-lg text-neutral-800 hover:bg-neutral-200 transition duration-150 shrink-0 cursor-pointer"
            >
              Limpar
            </button>
          </div>
        )}

        {/* Requested Screen Alert */}
        {selectedAgentId && requestedScreen && (
          <div className="bg-amber-50 border border-amber-250 rounded-xl p-3.5 space-y-2 mb-2">
            <div className="flex items-center space-x-2 text-amber-800 font-mono text-[10px] uppercase font-bold">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              <span>Transmissão Solicitada</span>
            </div>
            <p className="text-xs text-neutral-850 font-sans font-medium">
              O agente solicitou a transmissão da tela: <strong className="font-mono text-amber-800 font-bold">{requestedScreen.name}</strong>
            </p>
            {streamStatus === 'streaming' && (
              <button
                onClick={() => {
                  setAgentScreen(selectedAgentId, requestedScreen.id);
                  removePendingRequest(selectedAgentId);
                }}
                className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-sans font-bold text-[10px] transition duration-150 cursor-pointer shadow-sm uppercase font-mono"
              >
                Aprovar e Alterar Transmissão
              </button>
            )}
          </div>
        )}

        {/* Source Selector */}
        <div>
          <label className="block font-mono text-[10px] text-neutral-550 uppercase tracking-wider mb-2 font-bold">
            Selecionar Tela / Janela {selectedAgent ? 'para o Agente' : ''}
          </label>
          <div className="relative">
            <select
              value={activeScreen?.id || ''}
              onChange={(e) => {
                const found = screens.find((s) => s.id === e.target.value);
                if (found) {
                  if (selectedAgentId) {
                    setAgentScreen(selectedAgentId, found.id);
                    removePendingRequest(selectedAgentId);
                  } else {
                    selectScreen(found);
                  }
                }
              }}
              className="w-full px-3 py-2 bg-neutral-100 border border-neutral-305 rounded-xl text-xs text-neutral-900 outline-none focus:border-neutral-900 transition duration-150 font-mono font-medium"
            >
              {screens.length === 0 ? (
                <option value="">Nenhum ecrã/janela disponível</option>
              ) : (
                screens.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Thumbnail preview */}
          {activeScreen && (
            <div className="mt-3 aspect-video bg-neutral-200 rounded-xl overflow-hidden border border-neutral-300 relative group p-1 shadow-sm">
              <div className="w-full h-full rounded-lg overflow-hidden relative">
                <img
                  src={activeScreen.thumbnail}
                  alt="Preview"
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition duration-300"
                />
                <div className="absolute bottom-2 left-2 bg-neutral-950/90 px-2 py-0.5 rounded text-[9px] text-white font-mono tracking-wider font-bold">
                  RESOLUÇÃO DE CAPTURA
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Quick Refresh Button */}
        <button
          onClick={() => loadScreens()}
          className="w-full py-1.5 rounded-lg border border-neutral-200 text-xs font-mono font-bold uppercase text-neutral-550 hover:text-neutral-900 hover:bg-neutral-100 transition duration-150 cursor-pointer"
        >
          Recarregar Fontes
        </button>

        {/* Stream Parameters */}
        <div className="grid grid-cols-2 gap-3.5 pt-3.5 border-t border-neutral-200/60">
          {/* Codec */}
          <div>
            <label className="block font-mono text-[9px] text-neutral-550 uppercase mb-1 font-bold">Codec Vídeo</label>
            <select
              value={streamConfig.codec}
              onChange={(e) => setStreamConfig({ codec: e.target.value as VideoCodec })}
              className="w-full px-2.5 py-2 bg-neutral-100 border border-neutral-300 rounded-xl text-xs text-neutral-900 outline-none focus:border-neutral-900 transition duration-150"
            >
              {SUPPORTED_CODECS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* FPS */}
          <div>
            <label className="block font-mono text-[9px] text-neutral-550 uppercase mb-1 font-bold">Taxa Quadros (FPS)</label>
            <select
              value={streamConfig.fps}
              onChange={(e) => setStreamConfig({ fps: parseInt(e.target.value, 10) as any })}
              className="w-full px-2.5 py-2 bg-neutral-100 border border-neutral-300 rounded-xl text-xs text-neutral-900 outline-none focus:border-neutral-900 transition duration-150"
            >
              {SUPPORTED_FPS.map((fps) => (
                <option key={fps} value={fps}>
                  {fps} FPS
                </option>
              ))}
            </select>
          </div>

          {/* Resolution */}
          <div>
            <label className="block font-mono text-[9px] text-neutral-550 uppercase mb-1 font-bold">Resolução Máxima</label>
            <select
              value={
                typeof streamConfig.resolution === 'string'
                  ? 'auto'
                  : `${streamConfig.resolution.width}x${streamConfig.resolution.height}`
              }
              onChange={(e) => {
                if (e.target.value === 'auto') {
                  setStreamConfig({ resolution: 'auto' });
                } else {
                  const [w, h] = e.target.value.split('x').map((x) => parseInt(x, 10));
                  setStreamConfig({ resolution: { width: w, height: h } });
                }
              }}
              className="w-full px-2.5 py-2 bg-neutral-100 border border-neutral-300 rounded-xl text-xs text-neutral-900 outline-none focus:border-neutral-900 transition duration-150"
            >
              <option value="auto">Automático (Auto)</option>
              <option value="1280x720">720p (HD)</option>
              <option value="1920x1080">1080p (Full HD)</option>
              <option value="2560x1440">1440p (QHD)</option>
            </select>
          </div>

          {/* Transmission Mode */}
          <div>
            <label className="block font-mono text-[9px] text-neutral-550 uppercase mb-1 font-bold">Modo de Transmissão</label>
            <select
              value={streamConfig.transmissionMode}
              onChange={(e) => setStreamConfig({ transmissionMode: e.target.value as TransmissionMode })}
              className="w-full px-2.5 py-2 bg-neutral-100 border border-neutral-300 rounded-xl text-xs text-neutral-900 outline-none focus:border-neutral-900 transition duration-150"
            >
              <option value="mirror">Espelhar (Mirror)</option>
              <option value="cast">Transmitir (Cast)</option>
            </select>
          </div>
        </div>

        {/* Bitrate slider */}
        <div className="pt-3.5 border-t border-neutral-200/60">
          <div className="flex justify-between items-center text-[10px] font-mono mb-2">
            <span className="text-neutral-550 uppercase font-bold tracking-wider">Largura de Banda (Bitrate)</span>
            <span className="text-neutral-900 font-black">{(streamConfig.bitrate / 1000).toFixed(1)} Mbps</span>
          </div>
          <input
            type="range"
            min="1000"
            max="15000"
            step="500"
            value={streamConfig.bitrate}
            onChange={(e) => setStreamConfig({ bitrate: parseInt(e.target.value, 10) })}
            className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded-full cursor-pointer appearance-none outline-none"
          />
        </div>

        {/* Audio Toggles */}
        <div className="space-y-1.5 pt-3.5 border-t border-neutral-200/60">
          <Toggle
            label="Transmitir Áudio do Sistema"
            checked={streamConfig.audioEnabled}
            onChange={(checked) => setStreamConfig({ audioEnabled: checked })}
          />
          {streamConfig.audioEnabled && (
            <div className="flex items-center justify-between pl-4 font-mono">
              <span className="text-[10px] text-neutral-550 uppercase font-bold tracking-wider">Fonte de Áudio</span>
              <select
                value={streamConfig.audioSource}
                onChange={(e) => setStreamConfig({ audioSource: e.target.value as AudioSource })}
                className="bg-neutral-100 border border-neutral-300 px-2 py-1 rounded-lg text-xs text-neutral-900 outline-none focus:border-neutral-900 transition duration-150"
              >
                <option value="system">Som do Sistema</option>
                <option value="microphone">Microfone</option>
                <option value="both">Ambos</option>
              </select>
            </div>
          )}
          <Toggle
            label="Aceleração de Hardware (Encoding)"
            checked={streamConfig.hardwareEncoding}
            onChange={(checked) => setStreamConfig({ hardwareEncoding: checked })}
          />
        </div>
      </div>

      {/* Stream Control Action Buttons */}
      <div className="pt-4 border-t border-neutral-200/60 shrink-0">
        {streamStatus === 'streaming' ? (
          <div className="flex space-x-3">
            <button
              onClick={onPauseStream}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold font-mono tracking-wider uppercase bg-neutral-100 border border-neutral-250 text-neutral-800 hover:bg-neutral-200 transition duration-150 active:scale-[0.98] cursor-pointer"
            >
              Pausar
            </button>
            <button
              onClick={onStopStream}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold font-mono tracking-wider uppercase bg-neutral-50 border border-neutral-200 text-neutral-600 hover:bg-neutral-100 transition duration-150 active:scale-[0.98] cursor-pointer"
            >
              Parar
            </button>
          </div>
        ) : streamStatus === 'starting' ? (
          <button
            disabled
            className="w-full py-2.5 rounded-xl text-xs font-bold font-mono tracking-wider uppercase bg-neutral-100 text-neutral-400 border border-neutral-200 cursor-not-allowed text-center animate-pulse"
          >
            Iniciando Fluxo...
          </button>
        ) : requestedScreen ? (
          <button
            onClick={() => {
              if (selectedAgentId) {
                setAgentScreen(selectedAgentId, requestedScreen.id);
                removePendingRequest(selectedAgentId);
              }
              onStartStream();
            }}
            className="w-full py-2.5 rounded-xl text-sm font-bold font-mono tracking-wider bg-amber-500 hover:bg-amber-600 text-white active:scale-[0.98] transition duration-150 cursor-pointer uppercase shadow-sm animate-pulse"
          >
            Aprovar Transmissão
          </button>
        ) : (
          <button
            onClick={onStartStream}
            disabled={!activeScreen}
            className="w-full py-2.5 rounded-xl text-sm font-bold font-mono tracking-wider bg-neutral-900 text-white hover:bg-neutral-800 active:scale-[0.98] disabled:scale-100 transition duration-150 disabled:bg-neutral-200 disabled:text-neutral-450 disabled:cursor-not-allowed cursor-pointer uppercase shadow-sm"
          >
            Iniciar Transmissão
          </button>
        )}
      </div>
    </GlassCard>
  );
};
export default StreamControls;
