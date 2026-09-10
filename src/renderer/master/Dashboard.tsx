// SpaceViewer v2.2.9
import React, { useEffect, useState } from 'react';
import { useMasterStore } from '../stores/masterStore';
import { StreamControls } from './StreamControls';
import { GlassCard } from '../components/ui/GlassCard';
import { QRCodeDisplay } from '../components/ui/QRCodeDisplay';
import { StatusBadge } from '../components/ui/StatusBadge';

interface DashboardProps {
  onStartStream: () => void;
  onStopStream: () => void;
  onPauseStream: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  onStartStream,
  onStopStream,
  onPauseStream,
}) => {
  const {
    serverStatus,
    settings,
    connectedAgents,
    streamStatus,
    selectedAgentId,
    setSelectedAgentId,
    screens,
    pendingRequests,
    setAgentScreen,
    removePendingRequest,
  } = useMasterStore();
  const [ips, setIps] = useState<string[]>([]);

  useEffect(() => {
    window.screenflow.getNetworkAddresses().then((res) => {
      setIps(res);
    });
  }, []);

  const primaryIp = ips[0] || '127.0.0.1';
  const connectionUrl = `spaceviewer://connect/${primaryIp}:${settings.server.port}`;

  return (
    <div className="flex-1 flex flex-col lg:flex-row p-6 gap-6 overflow-y-auto h-full space-grid-bg relative select-none">
      {/* Column 1: Stream Parameters (1/3 width) */}
      <div className="w-full lg:w-[380px] shrink-0">
        <StreamControls
          onStartStream={onStartStream}
          onStopStream={onStopStream}
          onPauseStream={onPauseStream}
        />
      </div>

      {/* Column 2: Status Panel & Overview */}
      <div className="flex-1 flex flex-col space-y-6">
        {/* Row 1: Connection Gateway & Quick QR */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Server Details Card */}
          <GlassCard className="p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-neutral-500 uppercase tracking-wider font-bold">Gateway do Servidor</span>
                <StatusBadge status={streamStatus === 'streaming' ? 'streaming' : serverStatus === 'running' ? 'connected' : 'disconnected'} />
              </div>

              <div>
                <h3 className="font-display font-black text-2xl text-neutral-900 tracking-tight leading-none uppercase">
                  {streamStatus === 'streaming' ? 'Espelhamento Ativo' : 'Pronto para Conexão'}
                </h3>
                <p className="text-xs text-neutral-600 mt-2 leading-relaxed">
                  Dispositivos receptores na rede LAN podem sincronizar com este monitor utilizando o endereço IP ou escaneando o código QR.
                </p>
              </div>
            </div>

            <div className="space-y-3 pt-3 border-t border-neutral-200/60">
              <div>
                <span className="text-[9px] uppercase font-mono text-neutral-500 font-bold tracking-wider">Interface Principal IP</span>
                <div className="flex items-center space-x-2 mt-1">
                  <span className="font-mono font-black text-xl text-neutral-900 bg-neutral-100 border border-neutral-300/60 px-4 py-2 rounded-xl tracking-wide shadow-sm">
                    {primaryIp}:{settings.server.port}
                  </span>
                </div>
              </div>

              {ips.length > 1 && (
                <div>
                  <span className="text-[9px] uppercase font-mono text-neutral-500 font-bold tracking-wider">Outras Interfaces</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {ips.slice(1).map((ip) => (
                      <span key={ip} className="font-mono text-[10px] text-neutral-605 bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200">
                        {ip}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </GlassCard>

          {/* Connect QR Card */}
          <GlassCard className="p-5 flex flex-col items-center justify-center relative overflow-hidden">
            <QRCodeDisplay value={connectionUrl} size={130} label="Sincronizar Receptor" />
          </GlassCard>
        </div>

        {/* Row 2: Connected agents overview list */}
        <div className="flex-1 glass-panel glass-panel-hover rounded-2xl p-5 flex flex-col justify-between min-h-[220px]">
          <div>
            <div className="flex items-center justify-between border-b border-neutral-200/60 pb-3 mb-4">
              <h3 className="font-display font-bold text-sm text-neutral-900 uppercase tracking-wider">Destinos Ativos</h3>
              <span className="text-xs text-neutral-500 font-mono">Agentes: {connectedAgents.length}</span>
            </div>

            {connectedAgents.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-2">
                <svg className="w-8 h-8 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <p className="text-xs text-neutral-500 font-mono">Nenhum receptor espelhando este monitor no momento.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {connectedAgents.map((agent) => {
                  const isSelected = selectedAgentId === agent.id;
                  const isPending = agent.status === 'pending';
                  const requestedScreenId = pendingRequests[agent.id];
                  const requestedScreen = requestedScreenId ? screens.find((s) => s.id === requestedScreenId) : null;
                  return (
                    <div
                      key={agent.id}
                      onClick={() => {
                        if (!isPending) {
                          setSelectedAgentId(isSelected ? null : agent.id);
                        }
                      }}
                      className={`p-3.5 rounded-xl bg-white border flex items-center justify-between transition duration-150 ${
                        isPending
                          ? 'border-neutral-300 bg-neutral-50/50 animate-pulse'
                          : isSelected
                          ? 'border-neutral-900 shadow-sm bg-neutral-50/80 cursor-pointer font-bold'
                          : 'border-neutral-200/60 hover:border-neutral-350 hover:bg-neutral-50/30 cursor-pointer'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
                          {agent.name}
                          {agent.status === 'pending' && (
                            <span className="px-1.5 py-0.2 rounded bg-neutral-200 text-neutral-800 text-[8px] font-mono uppercase font-bold">
                              Pendente
                            </span>
                          )}
                        </span>
                        <span className="font-mono text-[10px] text-neutral-500 mt-0.5">{agent.ip}</span>
                        {requestedScreen && (
                          <span className="text-[10px] text-amber-600 font-semibold mt-1 font-mono">
                            Solicitou: {requestedScreen.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        {agent.status === 'pending' ? (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              await window.screenflow.acceptAgent(agent.id);
                            }}
                            className="px-2.5 py-1 rounded bg-neutral-900 hover:bg-neutral-800 text-white font-sans font-bold text-[10px] transition duration-150 cursor-pointer shadow-sm"
                          >
                            Aceitar
                          </button>
                        ) : (
                          <>
                            {requestedScreen && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setAgentScreen(agent.id, requestedScreenId);
                                  removePendingRequest(agent.id);
                                  if (streamStatus !== 'streaming') {
                                    onStartStream();
                                  }
                                }}
                                className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white font-sans font-bold text-[10px] transition duration-150 cursor-pointer shadow-sm mr-1.5 font-mono uppercase"
                              >
                                Aprovar
                              </button>
                            )}
                            <span className="font-mono text-[10px] text-neutral-800 bg-neutral-100 border border-neutral-200 px-2 py-0.5 rounded">
                              {agent.metrics.latency.toFixed(0)} ms
                            </span>
                            <span className={`h-1.5 w-1.5 rounded-full ${agent.status === 'streaming' ? 'bg-emerald-600' : 'bg-neutral-400'}`} />
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="text-[10px] text-neutral-500 font-mono uppercase tracking-wider pt-3 border-t border-neutral-200/60 mt-4 flex items-center justify-between">
            <span>Servidor WebRTC P2P</span>
            <span>Porta Padrão: {settings.server.port}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
export default Dashboard;

