// SpaceViewer v2.2.9
import React, { useEffect, useState } from 'react';
import { useMasterStore } from '../stores/masterStore';
import { GlassCard } from '../components/ui/GlassCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { QRCodeDisplay } from '../components/ui/QRCodeDisplay';
import type { Agent } from '../../shared/types';

export const AgentsList: React.FC = () => {
  const { connectedAgents, settings, refreshAgents } = useMasterStore();
  const [localIps, setLocalIps] = useState<string[]>([]);
  const [selectedAgentQuality, setSelectedAgentQuality] = useState<{ [id: string]: number }>({});
  
  // Discovered agents via mDNS scanning
  const [discoveredAgents, setDiscoveredAgents] = useState<any[]>([]);
  
  // Manual connection form states
  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState('7524');
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [inviteError, setInviteError] = useState('');
  
  // Connecting states per agent
  const [connectingAgents, setConnectingAgents] = useState<{ [key: string]: boolean }>({});

  useEffect(() => {
    // Fetch local IPs to generate server address
    window.screenflow.getNetworkAddresses().then((ips) => setLocalIps(ips || []));
    refreshAgents();

    const interval = setInterval(() => {
      refreshAgents();
    }, 2000);

    // Start scanning for agents in the LAN
    window.screenflow.discoverAgents().catch(console.error);

    // Listen for discovered agents
    const unsubscribeDiscovered = window.screenflow.onAgentDiscovered((agent) => {
      setDiscoveredAgents((prev) => {
        if (agent.offline) {
          return prev.filter((a) => a.host !== agent.host || a.port !== agent.port);
        }
        const exists = prev.some((a) => a.host === agent.host && a.port === agent.port);
        if (exists) {
          return prev.map((a) => (a.host === agent.host && a.port === agent.port ? agent : a));
        }
        return [...prev, agent];
      });
    });

    return () => {
      clearInterval(interval);
      unsubscribeDiscovered();
    };
  }, []);

  const handleDisconnect = async (id: string) => {
    if (confirm('Deseja desconectar este agente?')) {
      await window.screenflow.disconnectAgent(id);
      refreshAgents();
    }
  };

  const handleManualInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualIp) return;
    setInviteStatus('loading');
    setInviteError('');
    try {
      const res = await window.screenflow.inviteAgent(manualIp, parseInt(manualPort, 10));
      if (res.success) {
        setInviteStatus('success');
        setManualIp('');
        setTimeout(() => setInviteStatus('idle'), 3000);
      } else {
        setInviteStatus('error');
        setInviteError(res.error || 'Erro ao conectar');
      }
    } catch (err: any) {
      setInviteStatus('error');
      setInviteError(err.message || 'Erro de rede');
    }
  };

  const handleConnectDiscovered = async (agent: any) => {
    const key = `${agent.host}:${agent.port}`;
    setConnectingAgents((prev) => ({ ...prev, [key]: true }));
    try {
      const ip = agent.addresses[0] || agent.host;
      const res = await window.screenflow.inviteAgent(ip, agent.port);
      if (!res.success) {
        alert(`Erro ao conectar: ${res.error}`);
      }
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    } finally {
      setConnectingAgents((prev) => ({ ...prev, [key]: false }));
    }
  };

  const getAgentOSIcon = (os: string) => {
    return (
      <span className="px-2 py-0.5 rounded bg-neutral-200 text-[10px] text-neutral-805 font-mono uppercase tracking-wider">
        {os}
      </span>
    );
  };

  const primaryIp = localIps[0] || '127.0.0.1';
  const connectionUrl = `spaceviewer://connect/${primaryIp}:${settings.server.port}`;

  const pendingAgents = connectedAgents.filter((agent) => agent.status === 'pending');
  const authorizedAgents = connectedAgents.filter((agent) => agent.status !== 'pending');

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto h-full select-none space-grid-bg relative">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-neutral-200/40 pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200/60 pb-4">
        <div>
          <h2 className="font-display font-extrabold text-xl text-neutral-900 tracking-wide uppercase">Gerenciamento de Dispositivos</h2>
          <p className="text-xs text-neutral-605 mt-1">Conecte e gerencie receptores de tela SpaceViewer na rede local.</p>
        </div>
        <div className="font-mono text-xs text-neutral-600 bg-neutral-100 px-3 py-1.5 border border-neutral-200 rounded-xl">
          CONECTADOS: <span className="text-neutral-900 font-bold">{connectedAgents.length}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Connections Column */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Connection Requests (Pending) */}
          {pendingAgents.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-display font-bold text-xs uppercase tracking-wider text-neutral-900 flex items-center gap-2 font-mono">
                <span className="h-2 w-2 rounded-full bg-neutral-900 animate-pulse" />
                Solicitações Pendentes ({pendingAgents.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingAgents.map((agent) => (
                  <GlassCard key={agent.id} className="p-5 flex flex-col justify-between space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex flex-col">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-neutral-900 text-base">{agent.name}</span>
                          {getAgentOSIcon(agent.os)}
                        </div>
                        <span className="font-mono text-xs text-neutral-550 mt-1">{agent.ip}</span>
                      </div>
                      <StatusBadge status="pending" />
                    </div>

                    <p className="text-xs text-neutral-600 leading-relaxed font-sans">
                      Aguardando permissão para receber e exibir o sinal de vídeo deste PC.
                    </p>

                    <div className="flex space-x-3 pt-3 border-t border-neutral-200/60">
                      <button
                        onClick={async () => {
                          await window.screenflow.acceptAgent(agent.id);
                          refreshAgents();
                        }}
                        className="flex-1 py-2 rounded-xl text-xs font-bold font-mono tracking-wide bg-neutral-900 hover:bg-neutral-800 text-white transition duration-150 shadow-sm cursor-pointer text-center"
                      >
                        Autorizar
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm(`Deseja recusar a conexão de ${agent.name}?`)) {
                            await window.screenflow.disconnectAgent(agent.id);
                            refreshAgents();
                          }
                        }}
                        className="py-2 px-4 rounded-xl text-xs font-semibold tracking-wide bg-neutral-100 border border-neutral-250 hover:bg-neutral-200 text-neutral-800 transition duration-150 cursor-pointer"
                      >
                        Recusar
                      </button>
                    </div>
                  </GlassCard>
                ))}
              </div>
            </div>
          )}

          {/* Active Streaming / Connected Devices */}
          <div className="space-y-4">
            <h3 className="font-display font-bold text-xs uppercase tracking-wider text-neutral-900 flex items-center gap-2 font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              Sessões Ativas ({authorizedAgents.length})
            </h3>

            {authorizedAgents.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {authorizedAgents.map((agent) => {
                  const quality = selectedAgentQuality[agent.id] ?? 90;
                  return (
                    <GlassCard key={agent.id} className="p-5 flex flex-col justify-between space-y-4">
                      <div className="flex items-start justify-between">
                        <div className="flex flex-col">
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-neutral-900 text-base">{agent.name}</span>
                            {getAgentOSIcon(agent.os)}
                          </div>
                          <span className="font-mono text-xs text-neutral-550 mt-1">{agent.ip}</span>
                        </div>
                        <StatusBadge status={agent.status} />
                      </div>

                      {/* WebRTC Stats metrics */}
                      <div className="grid grid-cols-3 gap-2 bg-neutral-100 border border-neutral-200/60 p-3 rounded-xl font-mono text-[10px]">
                        <div className="flex flex-col items-center">
                          <span className="text-neutral-600 uppercase text-[8px] mb-0.5">Latência</span>
                          <span className="text-neutral-900 font-bold">{agent.metrics.latency.toFixed(0)} ms</span>
                        </div>
                        <div className="flex flex-col items-center border-x border-neutral-200">
                          <span className="text-neutral-600 uppercase text-[8px] mb-0.5">FPS Receptor</span>
                          <span className="text-neutral-900 font-bold">{agent.metrics.fps.toFixed(0)} fps</span>
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="text-neutral-600 uppercase text-[8px] mb-0.5">Largura Banda</span>
                          <span className="text-neutral-900 font-bold">{agent.metrics.bandwidth.toFixed(2)} Mbps</span>
                        </div>
                      </div>

                      {/* Streaming quality slider */}
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-[10px] font-mono">
                          <span className="text-neutral-550 uppercase">Qualidade do Sinal</span>
                          <span className="text-neutral-900 font-bold">{quality}%</span>
                        </div>
                        <input
                          type="range"
                          min="30"
                          max="100"
                          value={quality}
                          onChange={(e) => {
                            const q = parseInt(e.target.value, 10);
                            setSelectedAgentQuality((prev) => ({ ...prev, [agent.id]: q }));
                          }}
                          className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded-lg cursor-pointer animate-none"
                        />
                      </div>

                      <div className="flex space-x-2 pt-2 border-t border-neutral-200/60">
                        <button
                          onClick={() => handleDisconnect(agent.id)}
                          className="w-full py-2 rounded-xl text-xs font-bold font-mono tracking-wider bg-neutral-100 border border-neutral-250 hover:bg-neutral-200 text-neutral-805 transition duration-150 cursor-pointer"
                        >
                          Terminar Transmissão
                        </button>
                      </div>
                    </GlassCard>
                  );
                })}
              </div>
            ) : (
              <GlassCard className="p-8 text-center flex flex-col items-center justify-center space-y-4 min-h-[300px]">
                <div className="w-12 h-12 rounded-full bg-neutral-50 border border-neutral-200 flex items-center justify-center text-neutral-400">
                  <svg className="w-6 h-6 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-wider font-mono">Aguardando Recepção</h3>
                  <p className="text-xs text-neutral-605 max-w-sm leading-relaxed mx-auto">
                    Nenhum receptor ativo no momento. Use o painel lateral para convidar agentes ou pareá-los automaticamente.
                  </p>
                </div>
              </GlassCard>
            )}
          </div>
        </div>

        {/* Discovery & Invitation Column */}
        <div className="space-y-6">
          
          {/* Manual connection invite */}
          <GlassCard className="p-5 space-y-4">
            <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-wider font-mono">Conexão Manual</h3>
            <p className="text-xs text-neutral-600">
              Convide um dispositivo digitando seu endereço IP de rede local:
            </p>
            <form onSubmit={handleManualInvite} className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block font-mono text-[9px] text-neutral-600 uppercase mb-1">Endereço IP</label>
                  <input
                    type="text"
                    placeholder="ex: 192.168.0.25"
                    value={manualIp}
                    onChange={(e) => setManualIp(e.target.value)}
                    className="w-full bg-neutral-100 border border-neutral-300/60 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-250 rounded-xl px-3 py-2 text-xs text-neutral-900 outline-none"
                    required
                  />
                </div>
                <div className="w-20">
                  <label className="block font-mono text-[9px] text-neutral-600 uppercase mb-1">Porta</label>
                  <input
                    type="text"
                    value={manualPort}
                    onChange={(e) => setManualPort(e.target.value)}
                    className="w-full bg-neutral-100 border border-neutral-300/60 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-250 rounded-xl px-3 py-2 text-xs text-neutral-900 outline-none text-center font-mono"
                    required
                  />
                </div>
              </div>

              {inviteStatus === 'error' && (
                <p className="text-[10px] text-neutral-900 font-mono">{inviteError}</p>
              )}
              {inviteStatus === 'success' && (
                <p className="text-[10px] text-neutral-900 font-mono">Solicitação de pareamento enviada!</p>
              )}

              <button
                type="submit"
                disabled={inviteStatus === 'loading'}
                className="w-full py-2.5 rounded-xl text-xs font-bold font-mono tracking-wide bg-neutral-900 text-white hover:bg-neutral-800 active:scale-[0.98] transition duration-150 disabled:opacity-50 cursor-pointer"
              >
                {inviteStatus === 'loading' ? 'Conectando...' : 'Conectar ao Dispositivo'}
              </button>
            </form>
          </GlassCard>

          {/* Discovery LAN scan list */}
          <GlassCard className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-200/60 pb-2">
              <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-wider font-mono">Dispositivos LAN</h3>
              <div className="flex items-center space-x-1.5 bg-neutral-100 border border-neutral-200 px-2 py-0.5 rounded-full">
                <span className="h-1.5 w-1.5 rounded-full bg-neutral-800 animate-ping" />
                <span className="text-[9px] font-mono font-bold text-neutral-800 uppercase">Buscando</span>
              </div>
            </div>
            
            <p className="text-xs text-neutral-600 leading-relaxed">
              Agentes SpaceViewer descobertos no mesmo segmento de rede (mDNS):
            </p>

            <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
              {discoveredAgents.map((agent) => {
                const key = `${agent.host}:${agent.port}`;
                const isConnecting = connectingAgents[key];
                const ip = agent.addresses[0] || agent.host;

                return (
                  <div key={key} className="flex items-center justify-between bg-white border border-neutral-200 rounded-xl p-3">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-neutral-900 leading-tight">{agent.name}</span>
                      <span className="text-[9px] font-mono text-neutral-500 mt-0.5">{ip}:{agent.port}</span>
                    </div>
                    <button
                      onClick={() => handleConnectDiscovered(agent)}
                      disabled={isConnecting}
                      className="px-3 py-1.5 rounded-lg text-[10px] font-bold font-mono tracking-wider bg-neutral-100 border border-neutral-250 hover:bg-neutral-200 text-neutral-800 transition duration-150 cursor-pointer"
                    >
                      {isConnecting ? 'Conectando...' : 'Conectar'}
                    </button>
                  </div>
                );
              })}

              {discoveredAgents.length === 0 && (
                <div className="text-center py-5 border border-dashed border-neutral-200 rounded-xl">
                  <span className="text-[11px] font-mono text-neutral-500">Nenhum agente ativo detectado</span>
                </div>
              )}
            </div>
          </GlassCard>

          {/* QR Code Scan and Server Info */}
          <GlassCard className="p-5 flex flex-col items-center space-y-4 text-center">
            <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-wider font-mono">Pareamento via QR Code</h3>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Para fazer o receptor se conectar a este Transmissor, escaneie este código com a câmera do dispositivo:
            </p>
            <div className="bg-white p-2.5 rounded-xl inline-block shadow-md border border-neutral-200/60">
              <QRCodeDisplay value={connectionUrl} size={110} label="" />
            </div>
            <div className="bg-neutral-105 border border-neutral-200/60 px-3 py-2 rounded-xl font-mono text-[11px] w-full text-center">
              <span className="text-neutral-500 block text-[9px] uppercase mb-0.5">Endereço do Transmissor</span>
              <span className="text-neutral-900 font-bold">{primaryIp}:{settings.server.port}</span>
            </div>
          </GlassCard>

        </div>
      </div>
    </div>
  );
};

export default AgentsList;
