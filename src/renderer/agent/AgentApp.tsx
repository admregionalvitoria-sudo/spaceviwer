import React, { useEffect, useRef } from 'react';
import { useAgentStore } from '../stores/agentStore';
import { TitleBar } from '../components/ui/TitleBar';
import { ConnectScreen } from './ConnectScreen';
import { AgentView } from './AgentView';
import { GlassCard } from '../components/ui/GlassCard';
import { StreamPeer } from '../../shared/webrtc/peer';
import type { MasterInfo, SignalingMessage } from '../../shared/types';
import { STATS_INTERVAL } from '../../shared/constants';

export const AgentApp: React.FC = () => {
  const {
    connectionStatus,
    incomingStream,
    connectedMaster,
    setConnectionStatus,
    setConnectedMaster,
    setIncomingStream,
    setStreamStats,
    addToHistory,
    masterScreens,
    requestedScreenId,
    setMasterScreens,
    setRequestedScreenId,
  } = useAgentStore();

  const wsRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<StreamPeer | null>(null);
  const statsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const agentIdRef = useRef<string | null>(null);
  const iceBufferRef = useRef<any[]>([]);

  const disconnect = () => {
    console.log('[AgentApp] Disconnecting...');
    
    // Stop stats polling
    if (statsTimerRef.current) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }

    // Destroy WebRTC Peer
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionStatus('disconnected');
    setConnectedMaster(null);
    setIncomingStream(null);
    setStreamStats(null);
    setRequestedScreenId(null);
    setMasterScreens([]);
    agentIdRef.current = null;
  };

  const requestScreens = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log('[AgentApp] Requesting master screens list...');
      wsRef.current.send(
        JSON.stringify({
          type: 'get-screens',
        })
      );
    }
  };

  const requestStream = (screenId: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log('[AgentApp] Requesting screen stream:', screenId);
      wsRef.current.send(
        JSON.stringify({
          type: 'request-stream',
          payload: { screenId },
        })
      );
      setRequestedScreenId(screenId);
    }
  };

  const stopStreamOnly = () => {
    console.log('[AgentApp] Stopping stream only, returning to screens list...');
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    setIncomingStream(null);
    setStreamStats(null);
    setRequestedScreenId(null);
    requestScreens();
  };

  const connectToMaster = (master: MasterInfo) => {
    disconnect(); // Ensure clean state
    setConnectionStatus('connecting');
    setConnectedMaster(master);

    const wsUrl = `ws://${master.host}:${master.port}`;
    console.log('[AgentApp] Connecting to signaling server:', wsUrl);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[AgentApp] Signaling WebSocket opened');
        
        // Announce our presence as an agent
        const systemOs = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
        const msg: SignalingMessage = {
          type: 'agent-info',
          payload: {
            name: `Agente-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
            os: systemOs,
            osVersion: '10',
            resolution: { width: window.innerWidth, height: window.innerHeight },
            capabilities: {
              maxResolution: { width: 1920, height: 1080 },
              supportedCodecs: ['H264'],
              hardwareDecoding: true,
              audioOutput: true,
              miracast: false,
            },
          },
        };
        ws.send(JSON.stringify(msg));
        addToHistory(master);
      };

      ws.onmessage = (event) => {
        try {
          const msg: SignalingMessage = JSON.parse(event.data);
          handleSignalingMessage(msg);
        } catch (err) {
          console.error('[AgentApp] Failed to parse signaling message:', err);
        }
      };

      ws.onclose = (event) => {
        console.log('[AgentApp] Signaling WebSocket closed', event.reason);
        disconnect();
      };

      ws.onerror = (err) => {
        console.error('[AgentApp] Signaling WebSocket error:', err);
        setConnectionStatus('error');
      };
    } catch (err) {
      console.error('[AgentApp] Connection creation failed:', err);
      setConnectionStatus('error');
    }
  };

  const handleSignalingMessage = (msg: SignalingMessage) => {
    console.log('[AgentApp] Received message:', msg.type);

    switch (msg.type) {
      case 'auth-response': {
        const { agentId, status } = msg.payload as { agentId: string; status: string };
        if (status === 'ok') {
          agentIdRef.current = agentId;
          setConnectionStatus('connected');
          console.log('[AgentApp] Authenticated with agent ID:', agentId);
          requestScreens(); // Automatically request screens list on approval
        } else if (status === 'pending') {
          agentIdRef.current = agentId;
          setConnectionStatus('awaiting_authorization');
          console.log('[AgentApp] Awaiting authorization from master...');
        } else {
          setConnectionStatus('error');
          disconnect();
        }
        break;
      }

      case 'screens-list': {
        const screens = msg.payload as any[];
        console.log('[AgentApp] Received screens list:', screens);
        setMasterScreens(screens);
        break;
      }

      case 'webrtc-offer': {
        console.log('[AgentApp] Received WebRTC offer. Creating receiver peer...');
        iceBufferRef.current = []; // Clear buffer for new session
        setupReceiverPeer(msg.payload);
        break;
      }

      case 'ice-candidate': {
        if (peerRef.current) {
          peerRef.current.signal(msg.payload as any);
        } else {
          console.log('[AgentApp] Peer not ready. Buffering ICE candidate.');
          iceBufferRef.current.push(msg.payload);
        }
        break;
      }

      case 'stream-stop': {
        console.log('[AgentApp] Master stopped streaming');
        if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
        }
        setIncomingStream(null);
        setStreamStats(null);
        setRequestedScreenId(null);
        break;
      }

      default:
        break;
    }
  };

  const setupReceiverPeer = (offerSdp: unknown) => {
    if (peerRef.current) {
      peerRef.current.destroy();
    }

    const peer = new StreamPeer({
      isInitiator: false,
      onSignal: (signalData) => {
        // Send our answer SDP or ICE candidate back
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const type = signalData.type === 'answer' ? 'webrtc-answer' : 'ice-candidate';
          const msg: SignalingMessage = {
            type,
            payload: signalData,
          };
          wsRef.current.send(JSON.stringify(msg));
        }
      },
      onStream: (stream) => {
        console.log('[AgentApp] Remote MediaStream received!', stream.getTracks());
        setIncomingStream(stream);
        setRequestedScreenId(null); // Clear requested screen since stream has successfully started

        // Start stats polling
        if (statsTimerRef.current) clearInterval(statsTimerRef.current);
        statsTimerRef.current = setInterval(async () => {
          if (peerRef.current) {
            const stats = await peerRef.current.getStats();
            if (stats) {
              setStreamStats(stats as any);
            }
          }
        }, STATS_INTERVAL);
      },
      onClose: () => {
        console.log('[AgentApp] Peer connection closed');
        setIncomingStream(null);
        setStreamStats(null);
      },
      onError: (err) => {
        console.error('[AgentApp] Peer connection error:', err);
        setConnectionStatus('error');
        disconnect();
      },
    });

    peerRef.current = peer;
    peer.signal(offerSdp as any);

    // Flush any early buffered ICE candidates now that peer description is set
    if (iceBufferRef.current.length > 0) {
      console.log(`[AgentApp] Flushing ${iceBufferRef.current.length} buffered ICE candidates`);
      iceBufferRef.current.forEach((candidate) => {
        peer.signal(candidate);
      });
      iceBufferRef.current = [];
    }
  };

  // Listen for force-connect-to-master commands from the main process (Agent invitation)
  useEffect(() => {
    const unsubForceConnect = window.screenflow.onForceConnectToMaster((master) => {
      console.log('[AgentApp] Force-connect-to-master command received:', master);
      connectToMaster(master);
    });

    return () => {
      unsubForceConnect();
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  if (connectionStatus === 'awaiting_authorization') {
    return (
      <div className="flex-1 flex flex-col bg-bg-space select-none text-neutral-900 h-full w-full">
        <TitleBar subtitle="Aguardando Autorização" />
        <div className="flex-1 flex flex-col items-center justify-center p-6 space-grid-bg relative overflow-y-auto">
          <GlassCard className="p-8 max-w-md w-full text-center flex flex-col items-center justify-center space-y-6 shadow-xl relative overflow-hidden">
            <div className="relative w-20 h-20 flex items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-800">
                <svg className="w-6 h-6 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="font-display font-extrabold text-xl text-neutral-900 tracking-wide uppercase">
                Solicitação Enviada
              </h3>
              <p className="text-xs text-neutral-500 leading-relaxed">
                Aguardando aprovação no painel Master para iniciar a recepção de tela.
              </p>
            </div>

            {connectedMaster && (
              <div className="bg-neutral-50 border border-neutral-200/60 px-4 py-3 rounded-xl font-mono text-xs w-full text-left space-y-1">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Transmissor:</span>
                  <span className="text-neutral-900 font-bold">{connectedMaster.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-550">Endereço IP:</span>
                  <span className="text-neutral-900 font-bold">{connectedMaster.host}:{connectedMaster.port}</span>
                </div>
              </div>
            )}

            <button
              onClick={disconnect}
              className="w-full py-2.5 rounded-xl text-xs font-bold font-mono tracking-wide bg-rose-50 border border-rose-200 hover:bg-rose-100 hover:border-rose-300 text-rose-800 transition duration-150 cursor-pointer"
            >
              Cancelar Conexão
            </button>
          </GlassCard>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-space select-none">
      <TitleBar subtitle="Receptor" />
      <div className="flex-1 overflow-hidden relative bg-[#0A0F1E]/50">
        {connectionStatus === 'connected' ? (
          incomingStream ? (
            <AgentView onDisconnect={disconnect} onChangeScreen={stopStreamOnly} />
          ) : requestedScreenId ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 space-grid-bg relative overflow-y-auto h-full w-full">
              <GlassCard className="p-8 max-w-md w-full text-center flex flex-col items-center justify-center space-y-6 shadow-xl relative overflow-hidden">
                <div className="relative w-20 h-20 flex items-center justify-center">
                  <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-800">
                    <svg className="w-6 h-6 animate-spin text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3-3 3 3m-3-3v12" />
                    </svg>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="font-display font-extrabold text-xl text-neutral-900 tracking-wide uppercase">
                    Aguardando Autorização
                  </h3>
                  <p className="text-xs text-neutral-500 leading-relaxed">
                    Sua solicitação de tela foi enviada. Aguardando aprovação no painel do Transmissor.
                  </p>
                </div>

                {connectedMaster && (
                  <div className="bg-neutral-50 border border-neutral-200/60 px-4 py-3 rounded-xl font-mono text-xs w-full text-left space-y-1">
                    <div className="flex justify-between">
                      <span className="text-neutral-550">Transmissor:</span>
                      <span className="text-neutral-900 font-bold">{connectedMaster.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-555">Tela Solicitada:</span>
                      <span className="text-amber-800 font-bold">
                        {masterScreens.find((s) => s.id === requestedScreenId)?.name || 'Carregando...'}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    setRequestedScreenId(null);
                  }}
                  className="w-full py-2.5 rounded-xl text-xs font-bold font-mono tracking-wide bg-neutral-100 border border-neutral-200 hover:bg-neutral-200 text-neutral-700 transition duration-150 cursor-pointer"
                >
                  Voltar para Lista de Telas
                </button>
              </GlassCard>
            </div>
          ) : (
            <div className="flex-1 flex flex-col p-6 space-grid-bg relative overflow-y-auto h-full w-full">
              <div className="max-w-4xl mx-auto w-full space-y-6">
                {/* Header info */}
                <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-neutral-200/60 pb-4">
                  <div>
                    <h3 className="font-display font-extrabold text-lg text-neutral-900 tracking-tight uppercase">
                      Telas Disponíveis no Transmissor
                    </h3>
                    <p className="text-xs text-neutral-500 mt-1">
                      Selecione uma das telas ou janelas abaixo para solicitar a transmissão.
                    </p>
                  </div>
                  <div className="mt-4 md:mt-0 flex items-center space-x-3 font-mono text-xs">
                    <button
                      onClick={requestScreens}
                      className="px-3.5 py-1.5 rounded-xl bg-white border border-neutral-300 hover:border-neutral-450 text-neutral-750 hover:text-neutral-900 transition duration-150 cursor-pointer shadow-sm font-bold uppercase text-[10px]"
                    >
                      Atualizar Lista
                    </button>
                    <button
                      onClick={disconnect}
                      className="px-3.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-800 transition duration-150 cursor-pointer shadow-sm font-bold uppercase text-[10px]"
                    >
                      Desconectar
                    </button>
                  </div>
                </div>

                {masterScreens.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center p-12 space-y-4">
                    <svg className="w-10 h-10 text-neutral-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-neutral-800">Nenhuma tela disponível</p>
                      <p className="text-xs text-neutral-500">Aguardando o transmissor disponibilizar suas fontes de captura.</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                    {masterScreens.map((screen) => (
                      <div
                        key={screen.id}
                        onClick={() => requestStream(screen.id)}
                        className="group bg-white border border-neutral-200/80 hover:border-neutral-900 rounded-2xl overflow-hidden p-3.5 flex flex-col space-y-3 transition duration-200 cursor-pointer shadow-sm hover:shadow-md"
                      >
                        {/* Thumbnail */}
                        <div className="aspect-video bg-neutral-100 rounded-xl overflow-hidden border border-neutral-200 relative">
                          <img
                            src={screen.thumbnail}
                            alt={screen.name}
                            className="w-full h-full object-cover group-hover:scale-[1.03] transition duration-300"
                          />
                        </div>

                        {/* Name and Action */}
                        <div className="flex flex-col justify-between flex-1 space-y-3">
                          <span className="text-xs font-bold text-neutral-850 truncate group-hover:text-neutral-900 block" title={screen.name}>
                            {screen.name}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              requestStream(screen.id);
                            }}
                            className="w-full py-2 rounded-xl bg-neutral-900 group-hover:bg-neutral-800 text-white font-sans font-bold text-xs transition duration-150 cursor-pointer shadow-sm uppercase tracking-wide text-center"
                          >
                            Solicitar Transmissão
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
          <ConnectScreen onConnect={connectToMaster} />
        )}
      </div>
    </div>
  );
};
export default AgentApp;
