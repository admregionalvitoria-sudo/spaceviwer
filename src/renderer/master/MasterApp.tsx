import React, { useEffect, useRef, useState } from 'react';
import { useMasterStore } from '../stores/masterStore';
import { TitleBar } from '../components/ui/TitleBar';
import { BottomNav, SidebarTab } from '../components/ui/BottomNav';
import { ScreensPanel } from './ScreensPanel';
import { Dashboard } from './Dashboard';
import { AgentsList } from './AgentsList';
import { NetworkMonitor } from './NetworkMonitor';
import { Settings } from './Settings';
import { MoonlightPanel } from './MoonlightPanel';
import { StreamPeer } from '../../shared/webrtc/peer';
import { STATS_INTERVAL } from '../../shared/constants';
import type { SignalingMessage } from '../../shared/types';

interface MasterAppProps {
  onResetMode?: () => void;
  canResetMode?: boolean;
}

export const MasterApp: React.FC<MasterAppProps> = ({ onResetMode, canResetMode }) => {
  const {
    serverStatus,
    streamStatus,
    selectedScreen,
    streamConfig,
    connectedAgents,
    loadSettings,
    setServerStatus,
    setStreamStatus,
    addAgent,
    removeAgent,
    updateAgent,
    setConnectedAgents,
    setStreamStats,
    agentScreens,
    pendingRequests,
    addPendingRequest,
    removePendingRequest,
    setAgentScreen,
  } = useMasterStore();

  const [activeTab, setActiveTab] = useState<SidebarTab>('screens');
  const [moonlightClientsCount, setMoonlightClientsCount] = useState(0);
  const [screensCount, setScreensCount] = useState(1);

  const peersRef = useRef<Map<string, StreamPeer>>(new Map());
  const activeStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const peerScreenIdsRef = useRef<Map<string, string>>(new Map());
  const statsTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Setup screen capture helper
  const getOrCaptureScreenStream = async (screenId: string): Promise<MediaStream> => {
    const existing = activeStreamsRef.current.get(screenId);
    if (existing && existing.active) {
      return existing;
    }

    console.log('[MasterApp] Capturing screen source:', screenId);

    // Audio capture on Windows/Electron requires the chromeMediaSourceId to be specified for audio as well,
    // and it is only supported for screen sources (not window sources).
    const isWindow = screenId.startsWith('window:');

    if (streamConfig.audioEnabled && !isWindow) {
      try {
        console.log('[MasterApp] Attempting desktop audio and video capture for screen:', screenId);
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: screenId,
            },
          } as any,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: screenId,
              maxWidth: typeof streamConfig.resolution === 'string' ? 1920 : streamConfig.resolution.width,
              maxHeight: typeof streamConfig.resolution === 'string' ? 1080 : streamConfig.resolution.height,
              maxFrameRate: streamConfig.fps,
            },
          } as any,
        });

        activeStreamsRef.current.set(screenId, stream);
        return stream;
      } catch (audioErr) {
        console.warn('[MasterApp] Desktop audio capture failed, falling back to video-only capture:', audioErr);
      }
    }

    // Video-only capture (fallback or audio disabled or window source)
    console.log('[MasterApp] Attempting video-only capture for source:', screenId);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenId,
          maxWidth: typeof streamConfig.resolution === 'string' ? 1920 : streamConfig.resolution.width,
          maxHeight: typeof streamConfig.resolution === 'string' ? 1080 : streamConfig.resolution.height,
          maxFrameRate: streamConfig.fps,
        },
      } as any,
    });

    activeStreamsRef.current.set(screenId, stream);
    return stream;
  };

  // Setup main app bindings
  useEffect(() => {
    // Load initial settings
    loadSettings();

    // Determine if server is running
    window.screenflow.getServerStatus().then((status) => {
      setServerStatus(status === 'running' ? 'running' : 'stopped');
    });

    // Poll Moonlight paired clients count for the sidebar badge (every 10s)
    const refreshMoonlightClients = async () => {
      try {
        const list = await window.screenflow.getMoonlightClients();
        setMoonlightClientsCount(list?.length ?? 0);
      } catch {
        // ignore
      }
    };
    refreshMoonlightClients();
    const moonlightClientsTimer = setInterval(refreshMoonlightClients, 10000);

    // Track connected screens count
    const updateScreensCount = async () => {
      try {
        const list = await window.screenflow.getScreensDetailed();
        if (list && list.length > 0) {
          setScreensCount(list.length);
        }
      } catch {}
    };
    updateScreensCount();
    const unsubScreens = window.screenflow.onScreensChanged(() => {
      updateScreensCount();
    });

    // Handle agent connection events
    const unsubConnect = window.screenflow.onAgentConnected(async (agent) => {
      console.log('[MasterApp] Agent connected event:', agent);
      addAgent(agent as any);

      // Hot-plugging: if streaming, start sending to this agent immediately!
      const isPending = agent.status === 'pending' || (agent as any).authenticated === false;
      if (!isPending && streamStatus === 'streaming') {
        console.log('[MasterApp] Streaming active, initiating connection to new agent', agent.id);
        try {
          const screenId = agentScreens[agent.id] || selectedScreen?.id;
          if (screenId) {
            const stream = await getOrCaptureScreenStream(screenId);
            setupInitiatorPeer(agent.id, stream);
            peerScreenIdsRef.current.set(agent.id, screenId);
          }
        } catch (err) {
          console.error('[MasterApp] Hot-plug stream capture failed for agent:', agent.id, err);
        }
      }
    });

    const unsubDisconnect = window.screenflow.onAgentDisconnected((id) => {
      console.log('[MasterApp] Agent disconnected event:', id);
      removeAgent(id);
      removePendingRequest(id);
      
      const peer = peersRef.current.get(id);
      if (peer) {
        peer.destroy();
        peersRef.current.delete(id);
      }
      peerScreenIdsRef.current.delete(id);
    });

    // Handle signaling responses from agents
    const unsubSignaling = window.screenflow.onSignalingMessage((msg: SignalingMessage) => {
      const { fromId, type, payload } = msg;
      if (!fromId) return;

      if (type === 'get-screens') {
        console.log('[MasterApp] Agent requested screens list:', fromId);
        window.screenflow.sendMessageToAgent(
          fromId,
          JSON.stringify({
            type: 'screens-list',
            payload: useMasterStore.getState().screens,
          })
        );
        return;
      }

      if (type === 'request-stream') {
        const { screenId } = payload as { screenId: string };
        console.log(`[MasterApp] Agent ${fromId} requested screen ${screenId}`);
        addPendingRequest(fromId, screenId);
        return;
      }

      const peer = peersRef.current.get(fromId);
      if (peer) {
        if (type === 'webrtc-answer' || type === 'ice-candidate') {
          console.log(`[MasterApp] Feeding signal ${type} from agent ${fromId}`);
          peer.signal(payload as any);
        }
      }
    });

    return () => {
      unsubConnect();
      unsubDisconnect();
      unsubSignaling();
      stopStreamingEngine();
      clearInterval(moonlightClientsTimer);
    };
  }, [streamStatus, selectedScreen, agentScreens]);

  // Live track swapping when agent's configured screen changes on the fly
  useEffect(() => {
    if (streamStatus !== 'streaming') return;

    const updateTracksOnTheFly = async () => {
      for (const agent of connectedAgents) {
        const isPending = agent.status === 'pending' || (agent as any).authenticated === false;
        if (isPending) continue;

        const configuredScreenId = agentScreens[agent.id] || selectedScreen?.id;
        const currentScreenId = peerScreenIdsRef.current.get(agent.id);

        if (configuredScreenId && configuredScreenId !== currentScreenId) {
          console.log(`[MasterApp] Stream source for agent ${agent.name} changed: ${currentScreenId} -> ${configuredScreenId}`);
          
          try {
            // 1. Get or capture the new stream
            const newStream = await getOrCaptureScreenStream(configuredScreenId);
            
            // 2. Find the active peer for this agent
            const peer = peersRef.current.get(agent.id);
            if (peer) {
              const oldStream = currentScreenId ? activeStreamsRef.current.get(currentScreenId) : null;
              
              // Get video tracks
              const oldVideoTrack = oldStream?.getVideoTracks()[0];
              const newVideoTrack = newStream.getVideoTracks()[0];
              
              if (oldVideoTrack && newVideoTrack) {
                peer.replaceTrack(oldVideoTrack, newVideoTrack, newStream);
              } else if (newVideoTrack) {
                // Try replacing track without oldTrack reference
                const pc = (peer as any).peer?._pc;
                if (pc) {
                  const sender = pc.getSenders().find((s: any) => s.track?.kind === 'video');
                  sender?.replaceTrack(newVideoTrack);
                }
              }
              
              // Handle audio track replacement if audio is enabled
              if (streamConfig.audioEnabled) {
                const oldAudioTrack = oldStream?.getAudioTracks()[0];
                const newAudioTrack = newStream.getAudioTracks()[0];
                if (oldAudioTrack && newAudioTrack) {
                  peer.replaceTrack(oldAudioTrack, newAudioTrack, newStream);
                }
              }
            } else {
              setupInitiatorPeer(agent.id, newStream);
            }
            
            // 3. Update active screen tracking
            peerScreenIdsRef.current.set(agent.id, configuredScreenId);
            
            // 4. Clean up old stream if it's no longer used by any agent
            if (currentScreenId) {
              const isStillUsed = Array.from(peerScreenIdsRef.current.entries()).some(
                ([id, sId]) => id !== agent.id && sId === currentScreenId
              );
              if (!isStillUsed) {
                const oldStream = activeStreamsRef.current.get(currentScreenId);
                if (oldStream) {
                  console.log(`[MasterApp] Closing unused screen stream capture: ${currentScreenId}`);
                  oldStream.getTracks().forEach((track) => track.stop());
                  activeStreamsRef.current.delete(currentScreenId);
                }
              }
            }
          } catch (err) {
            console.error(`[MasterApp] Failed to change stream source for agent ${agent.name}:`, err);
          }
        }
      }
    };

    updateTracksOnTheFly();
  }, [agentScreens, streamStatus, connectedAgents, selectedScreen, streamConfig.audioEnabled]);

  const startStreamingEngine = async () => {
    if (!selectedScreen) {
      alert('Selecione uma tela para capturar primeiro.');
      return;
    }

    setStreamStatus('starting');

    try {
      // Create P2P Peer Connections for all currently connected agents
      for (const agent of connectedAgents) {
        const isPending = agent.status === 'pending' || (agent as any).authenticated === false;
        if (!isPending) {
          const screenId = agentScreens[agent.id] || selectedScreen.id;
          const stream = await getOrCaptureScreenStream(screenId);
          setupInitiatorPeer(agent.id, stream);
          peerScreenIdsRef.current.set(agent.id, screenId);
        }
      }

      // Start capture triggers signaling state updates on backend
      const captureConf = {
        sourceId: selectedScreen.id,
        fps: streamConfig.fps,
        width: typeof streamConfig.resolution === 'string' ? 1920 : streamConfig.resolution.width,
        height: typeof streamConfig.resolution === 'string' ? 1080 : streamConfig.resolution.height,
        audioEnabled: streamConfig.audioEnabled,
      };
      await window.screenflow.startCapture(captureConf);

      setStreamStatus('streaming');

      // Start stats reporting timer
      if (statsTimerRef.current) clearInterval(statsTimerRef.current);
      statsTimerRef.current = setInterval(reportPerformanceStats, STATS_INTERVAL);

    } catch (err) {
      console.error('[MasterApp] Screen capture failed:', err);
      setStreamStatus('error');
      alert(`Falha ao iniciar a captura: ${err}`);
      stopStreamingEngine();
    }
  };

  const setupInitiatorPeer = (agentId: string, stream: MediaStream) => {
    // Clean up if existing
    const existing = peersRef.current.get(agentId);
    if (existing) {
      existing.destroy();
    }

    console.log('[MasterApp] Instantiating initiator WebRTC peer for agent:', agentId);
    const peer = new StreamPeer({
      isInitiator: true,
      stream,
      onSignal: (signalData) => {
        // Wrap and send signal offer/ICE to agent
        const type = signalData.type === 'offer' ? 'webrtc-offer' : 'ice-candidate';
        window.screenflow.sendMessageToAgent(
          agentId,
          JSON.stringify({
            type,
            targetId: agentId,
            payload: signalData,
          })
        );
      },
      onClose: () => {
        console.log('[MasterApp] Connection closed with agent:', agentId);
        peersRef.current.delete(agentId);
      },
      onError: (err) => {
        console.error('[MasterApp] Connection error with agent:', agentId, err);
        const p = peersRef.current.get(agentId);
        if (p) {
          try {
            p.destroy();
          } catch (e) {
            console.error('[MasterApp] Error destroying peer on error:', e);
          }
          peersRef.current.delete(agentId);
        }
        peerScreenIdsRef.current.delete(agentId);
        updateAgent(agentId, {
          status: 'connected',
        });
      },
    });

    peersRef.current.set(agentId, peer);
  };

  const reportPerformanceStats = async () => {
    let totalBandwidth = 0;
    let totalLatency = 0;
    let totalFps = 0;
    let validCount = 0;

    for (const [id, peer] of peersRef.current.entries()) {
      const stats = await peer.getStats();
      if (stats) {
        totalBandwidth += stats.bandwidth;
        totalLatency += stats.latency;
        totalFps += stats.fps;
        validCount++;

        // Update stats on masterStore for this specific agent card
        updateAgent(id, {
          status: 'streaming',
          metrics: {
            latency: stats.latency,
            fps: stats.fps,
            bandwidth: stats.bandwidth,
            packetsLost: stats.packetsLost,
            jitter: stats.jitter,
            decodingTime: 0,
          },
        });
      }
    }

    if (validCount > 0) {
      const finalStats = {
        totalBandwidth,
        avgLatency: totalLatency / validCount,
        avgFps: totalFps / validCount,
        activeAgents: validCount,
        encodingFps: totalFps / validCount,
        cpuUsage: 12, // fallback indicator
        gpuUsage: 8,  // fallback indicator
        uptime: 0,
      };
      setStreamStats(finalStats);
    }
  };

  const stopStreamingEngine = async () => {
    console.log('[MasterApp] Stopping streaming engine...');
    
    if (statsTimerRef.current) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }

    // Stop signaling capturer on main process
    await window.screenflow.stopCapture();

    // Destroy all WebRTC Peers
    peersRef.current.forEach((peer) => peer.destroy());
    peersRef.current.clear();

    // Stop Media tracks
    activeStreamsRef.current.forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop());
    });
    activeStreamsRef.current.clear();
    peerScreenIdsRef.current.clear();

    // Reset agent status lists back to 'connected'
    connectedAgents.forEach((agent) => {
      updateAgent(agent.id, {
        status: 'connected',
        metrics: {
          latency: 0,
          fps: 0,
          bandwidth: 0,
          packetsLost: 0,
          jitter: 0,
          decodingTime: 0,
        },
      });
    });

    setStreamStatus('idle');
    setStreamStats(null);
  };

  const pauseStreamingEngine = async () => {
    if (streamStatus === 'streaming') {
      console.log('[MasterApp] Pausing stream (disabling tracks)');
      activeStreamsRef.current.forEach((stream) => {
        stream.getVideoTracks().forEach((t) => (t.enabled = false));
        stream.getAudioTracks().forEach((t) => (t.enabled = false));
      });
      
      await window.screenflow.pauseCapture();
      
      connectedAgents.forEach((agent) => {
        updateAgent(agent.id, { status: 'paused' });
      });

      setStreamStatus('paused');
    } else if (streamStatus === 'paused') {
      console.log('[MasterApp] Resuming stream (enabling tracks)');
      activeStreamsRef.current.forEach((stream) => {
        stream.getVideoTracks().forEach((t) => (t.enabled = true));
        stream.getAudioTracks().forEach((t) => (t.enabled = true));
      });
      
      const captureConf = {
        sourceId: selectedScreen?.id || '',
        fps: streamConfig.fps,
        width: typeof streamConfig.resolution === 'string' ? 1920 : streamConfig.resolution.width,
        height: typeof streamConfig.resolution === 'string' ? 1080 : streamConfig.resolution.height,
        audioEnabled: streamConfig.audioEnabled,
      };
      await window.screenflow.startCapture(captureConf);

      connectedAgents.forEach((agent) => {
        updateAgent(agent.id, { status: 'streaming' });
      });

      setStreamStatus('streaming');
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-space select-none text-slate-100 h-full w-full relative">
      <TitleBar subtitle="Transmissor (Master)" />

      {/* Main Content Router */}
      <main className="flex-1 min-h-0 w-full overflow-hidden relative">
        {activeTab === 'screens' && <ScreensPanel />}

        {activeTab === 'dashboard' && (
          <Dashboard
            onStartStream={startStreamingEngine}
            onStopStream={stopStreamingEngine}
            onPauseStream={pauseStreamingEngine}
          />
        )}

        {activeTab === 'agents' && <AgentsList />}

        {activeTab === 'moonlight' && <MoonlightPanel />}

        {activeTab === 'network' && <NetworkMonitor />}

        {activeTab === 'settings' && <Settings />}
      </main>

      {/* Bottom Dock Navigation Bar */}
      <BottomNav
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        serverStatus={serverStatus}
        streamStatus={streamStatus}
        activeAgentsCount={connectedAgents.length}
        moonlightClientsCount={moonlightClientsCount}
        screensCount={screensCount}
        onStopStream={stopStreamingEngine}
        onStartStream={startStreamingEngine}
        onResetMode={onResetMode}
        canResetMode={canResetMode}
      />
    </div>
  );
};
export default MasterApp;
