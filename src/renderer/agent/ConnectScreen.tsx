import React, { useEffect, useState } from 'react';
import { useAgentStore } from '../stores/agentStore';
import { GlassCard } from '../components/ui/GlassCard';
import type { MasterInfo } from '../../shared/types';

interface ConnectScreenProps {
  onConnect: (master: MasterInfo) => void;
}

export const ConnectScreen: React.FC<ConnectScreenProps> = ({ onConnect }) => {
  const { discoveredMasters, connectionHistory, connectionStatus, loadHistory, clearDiscovered } = useAgentStore();
  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState('7523');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    loadHistory();
    clearDiscovered();
    // Start discovering
    window.screenflow.discoverMasters();
  }, []);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualIp) {
      setErrorMessage('Por favor, introduza um endereço IP.');
      return;
    }

    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (!ipRegex.test(manualIp)) {
      setErrorMessage('Endereço IP inválido.');
      return;
    }

    const portNum = parseInt(manualPort, 10);
    if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
      setErrorMessage('Porta inválida (deve ser 1-65535).');
      return;
    }

    setErrorMessage('');
    onConnect({
      name: `Manual (${manualIp})`,
      host: manualIp,
      addresses: [manualIp],
      port: portNum,
    });
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row items-center justify-center p-6 gap-6 overflow-y-auto bg-bg-space text-neutral-900 relative h-full">

      {/* Discovery radar column */}
      <div className="w-full md:w-1/2 max-w-md flex flex-col space-y-4 h-full max-h-[580px]">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-lg text-neutral-900 tracking-wide">Procurando Transmissores...</h2>
          {/* Radar indicator */}
          <div className="flex items-center space-x-2">
            <span className="h-2 w-2 rounded-full bg-neutral-900" />
            <span className="font-mono text-xs text-neutral-900 uppercase tracking-wider">Escaneando LAN</span>
          </div>
        </div>

        {/* Discovered masters list */}
        <div className="flex-1 glass-panel glass-panel-hover rounded-2xl p-4 overflow-y-auto min-h-[220px]">
          {discoveredMasters.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-3 p-4">
              {/* Spinning Radar Icon */}
              <div className="relative w-12 h-12 rounded-full border border-neutral-300/40 flex items-center justify-center animate-spin">
                <div className="absolute top-0 w-2 h-2 rounded-full bg-neutral-900" />
              </div>
              <p className="text-xs text-neutral-500">Nenhum transmissor SpaceViewer detectado automaticamente na rede local ainda.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {discoveredMasters.map((master) => (
                <GlassCard
                  key={master.name}
                  onClick={() => onConnect(master)}
                  glowColor="none"
                  className="p-4 hover:bg-neutral-50/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="font-bold text-neutral-900 text-sm">{master.name.replace('SpaceViewer-', '')}</span>
                      <span className="font-mono text-xs text-neutral-500 mt-0.5">
                        {master.addresses[0] || master.host}:{master.port}
                      </span>
                    </div>
                    {/* OS Tag & Action */}
                    <div className="flex items-center space-x-2">
                      {master.os && (
                        <span className="px-2 py-0.5 rounded bg-neutral-200 text-[10px] text-neutral-700 font-mono uppercase">
                          {master.os}
                        </span>
                      )}
                      <svg
                        className="w-5 h-5 text-neutral-900"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Manual Connection and History Column */}
      <div className="w-full md:w-1/2 max-w-md flex flex-col space-y-4 h-full max-h-[580px]">
        {/* Manual connect form */}
        <GlassCard className="p-5">
          <h2 className="font-display font-bold text-base text-neutral-900 mb-4">Conexão Manual</h2>
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block font-mono text-[10px] text-neutral-500 uppercase mb-1">Endereço IP</label>
                <input
                  type="text"
                  placeholder="ex: 192.168.1.15"
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm border glass-input"
                />
              </div>
              <div className="w-24">
                <label className="block font-mono text-[10px] text-neutral-500 uppercase mb-1">Porta</label>
                <input
                  type="text"
                  value={manualPort}
                  onChange={(e) => setManualPort(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm border glass-input text-center font-mono"
                />
              </div>
            </div>

            {errorMessage && <p className="text-xs text-rose-800 font-mono">{errorMessage}</p>}

            <button
              type="submit"
              disabled={connectionStatus === 'connecting'}
              className="w-full py-2.5 rounded-xl text-sm font-semibold tracking-wide btn-primary-white active:scale-[0.98] transition duration-150 disabled:opacity-50 cursor-pointer shadow-md"
            >
              {connectionStatus === 'connecting' ? 'A conectar...' : 'Conectar ao Transmissor'}
            </button>
          </form>
        </GlassCard>

        {/* Connection History */}
        <div className="flex-1 glass-panel glass-panel-hover rounded-2xl p-4 overflow-y-auto min-h-[160px]">
          <h3 className="font-display font-bold text-sm text-neutral-800 mb-3 tracking-wide">Conexões Recentes</h3>
          {connectionHistory.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center p-4">
              <p className="text-xs text-neutral-450 font-mono">Nenhum histórico disponível.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {connectionHistory.map((history, idx) => (
                <div
                  key={`${history.host}-${history.port}-${idx}`}
                  onClick={() => onConnect(history)}
                  className="flex items-center justify-between p-3 rounded-xl bg-white/80 border border-neutral-200/60 hover:border-neutral-450 cursor-pointer hover:bg-neutral-50/50 transition duration-150"
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-neutral-900">{history.name.replace('SpaceViewer-', '')}</span>
                    <span className="font-mono text-[10px] text-neutral-500 mt-0.5">
                      {history.host}:{history.port}
                    </span>
                  </div>
                  <svg className="w-4 h-4 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
