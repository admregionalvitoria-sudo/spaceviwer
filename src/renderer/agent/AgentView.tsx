// SpaceViewer v2.2.9
import React, { useEffect, useRef, useState } from 'react';
import { useAgentStore } from '../stores/agentStore';
import { createVolumeController } from '../../shared/webrtc/audio';

interface AgentViewProps {
  onDisconnect: () => void;
  onChangeScreen: () => void;
}

export const AgentView: React.FC<AgentViewProps> = ({ onDisconnect, onChangeScreen }) => {
  const { incomingStream, volume, setVolume, fullscreen, setFullscreen, streamStats } = useAgentStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const volumeControllerRef = useRef<any>(null);
  const [showToolbar, setShowToolbar] = useState(true);
  const toolbarTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Bind media stream
  useEffect(() => {
    if (videoRef.current && incomingStream) {
      videoRef.current.srcObject = incomingStream;
      console.log('[AgentView] MediaStream bound to video element', incomingStream.getTracks());
      
      // Explicitly trigger play to prevent black screen (autoplay restriction workaround)
      videoRef.current.play().catch((err) => {
        console.error('[AgentView] Error playing video stream:', err);
      });
      
      // Setup audio volume controller if audio track exists
      const audioTracks = incomingStream.getAudioTracks();
      if (audioTracks.length > 0) {
        console.log('[AgentView] Audio tracks found, configuring volume controller');
        try {
          if (volumeControllerRef.current) {
            volumeControllerRef.current.destroy();
          }
          const controller = createVolumeController(incomingStream);
          controller.setVolume(volume);
          volumeControllerRef.current = controller;
        } catch (err) {
          console.error('[AgentView] Failed to create volume controller:', err);
        }
      }
    }

    return () => {
      if (volumeControllerRef.current) {
        volumeControllerRef.current.destroy();
        volumeControllerRef.current = null;
      }
    };
  }, [incomingStream]);

  // Adjust volume on the fly
  useEffect(() => {
    if (volumeControllerRef.current) {
      volumeControllerRef.current.setVolume(volume);
    }
  }, [volume]);

  // Toggle fullscreen
  const handleToggleFullscreen = () => {
    const nextState = !fullscreen;
    setFullscreen(nextState);
    window.screenflow.toggleFullscreen(nextState);
  };

  // Toolbar auto-hide logic
  const handleMouseMove = () => {
    setShowToolbar(true);
    if (toolbarTimeoutRef.current) {
      clearTimeout(toolbarTimeoutRef.current);
    }
    toolbarTimeoutRef.current = setTimeout(() => {
      if (!fullscreen) return; // Keep toolbar visible if not fullscreen
      setShowToolbar(false);
    }, 3000);
  };

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (toolbarTimeoutRef.current) clearTimeout(toolbarTimeoutRef.current);
    };
  }, [fullscreen]);

  return (
    <div
      className="flex-1 bg-black relative flex items-center justify-center overflow-hidden h-full w-full"
      onMouseMove={handleMouseMove}
    >
      {/* Video Element (Muted because Audio plays via Web Audio API) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-contain"
      />

      {/* Stats Overlay (Top-Right) */}
      {streamStats && (
        <div className="absolute top-4 right-4 glass-panel px-4 py-2.5 rounded-xl flex flex-col space-y-1 font-mono text-xs text-neutral-900 pointer-events-none z-30 shadow-md">
          <div className="flex justify-between space-x-6">
            <span className="text-neutral-500">FPS:</span>
            <span className="font-bold text-neutral-900">{streamStats.fps.toFixed(0)}</span>
          </div>
          <div className="flex justify-between space-x-6">
            <span className="text-neutral-500">Latência:</span>
            <span className="font-bold text-neutral-900">{streamStats.latency.toFixed(0)} ms</span>
          </div>
          <div className="flex justify-between space-x-6">
            <span className="text-neutral-500">Banda:</span>
            <span className="font-bold text-neutral-900">{streamStats.bandwidth.toFixed(2)} Mbps</span>
          </div>
          {streamStats.packetsLost > 0 && (
            <div className="flex justify-between space-x-6">
              <span className="text-rose-800 font-bold">Perdas:</span>
              <span className="font-bold text-rose-800">{streamStats.packetsLost} pkts</span>
            </div>
          )}
        </div>
      )}

      {/* Connection Indicator (Top-Left) */}
      <div className="absolute top-4 left-4 flex items-center space-x-2 glass-panel px-3 py-1.5 rounded-xl z-30 pointer-events-none shadow-md">
        <span className="h-2 w-2 rounded-full bg-neutral-900" />
        <span className="font-sans text-xs font-semibold text-neutral-900 uppercase tracking-wider">Recepção Ativa</span>
      </div>

      {/* Control Dock (Auto-hiding bottom toolbar) */}
      <div
        className={`absolute bottom-6 left-1/2 -translate-x-1/2 transition-all duration-300 transform z-40 ${
          showToolbar ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0 pointer-events-none'
        }`}
      >
        <div className="glass-panel px-6 py-3.5 rounded-2xl flex items-center space-x-6 shadow-xl">
          {/* Disconnect Button */}
          <button
            onClick={onDisconnect}
            className="flex items-center space-x-2 px-3.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 hover:border-rose-300 text-rose-800 text-xs font-bold transition duration-200 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            <span>Desconectar</span>
          </button>

          {/* Separator */}
          <span className="h-5 w-px bg-neutral-200" />

          {/* Mudar Tela Button */}
          <button
            onClick={onChangeScreen}
            className="flex items-center space-x-2 px-3.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 hover:border-amber-300 text-amber-800 text-xs font-bold transition duration-200 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 5a1 1 0 011-1h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13h16"
              />
            </svg>
            <span>Mudar Tela</span>
          </button>

          {/* Separator */}
          <span className="h-5 w-px bg-neutral-200" />

          {/* Volume Control */}
          <div className="flex items-center space-x-3 text-neutral-900">
            <button
              onClick={() => setVolume(volume > 0 ? 0 : 50)}
              className="text-neutral-500 hover:text-neutral-900 transition duration-150 cursor-pointer"
            >
              {volume === 0 ? (
                <svg className="w-5 h-5 text-rose-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-neutral-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                  />
                </svg>
              )}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(e) => setVolume(parseInt(e.target.value, 10))}
              className="w-24 accent-neutral-900 bg-neutral-200 h-1 rounded-lg cursor-pointer"
            />
            <span className="font-mono text-xs text-neutral-850 w-8 text-right">{volume}%</span>
          </div>

          {/* Separator */}
          <span className="h-5 w-px bg-neutral-200" />

          {/* Fullscreen Button */}
          <button
            onClick={handleToggleFullscreen}
            className="text-neutral-500 hover:text-neutral-900 transition duration-150 p-1 rounded-lg hover:bg-neutral-100/50 cursor-pointer"
            title={fullscreen ? 'Sair de Tela Cheia' : 'Tela Cheia'}
          >
            {fullscreen ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 14h6m0 0v6m0-6L3 21m17-7h-6m0 0v6m0-6l7 7M10 10V4m0 6H4m0 0l-7-7m17 7V4m0 6h6m0 0l7-7"
                />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
