// SpaceViewer v2.2.9
import React, { useEffect, useRef, useState } from 'react';

interface ProjectorViewProps {
  sourceId: string;
  appName: string;
  displayId?: string;
}

export const ProjectorView: React.FC<ProjectorViewProps> = ({ sourceId, appName, displayId }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [showHud, setShowHud] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

  const resetHudTimer = () => {
    setShowHud(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setShowHud(false);
    }, 3000);
  };

  const handleClose = () => {
    if (displayId) {
      if (window.screenflow.stopAppProjector) {
        window.screenflow.stopAppProjector(displayId);
      } else {
        window.screenflow.stopObsProjector(displayId);
      }
    } else {
      window.close();
    }
  };

  const [retryTrigger, setRetryTrigger] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function initCapture() {
      try {
        console.log('[ProjectorView] Capturing source for projection:', sourceId);
        let stream: MediaStream | null = null;
        let lastError: any = null;

        // Attempt 1: Standard constraints (Full HD / 60fps)
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sourceId,
                maxWidth: 1920,
                maxHeight: 1080,
                maxFrameRate: 60,
              },
            } as any,
          });
        } catch (err1) {
          console.warn('[ProjectorView] Attempt 1 with 1080p constraints failed, attempting fallback without resolution limits:', err1);
          lastError = err1;
        }

        // Attempt 2: Minimal fallback (no resolution/fps limits, just raw source capture)
        if (!stream) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId,
                },
              } as any,
            });
          } catch (err2) {
            console.warn('[ProjectorView] Attempt 2 without constraints failed:', err2);
            lastError = err2;
          }
        }

        if (!stream) {
          throw lastError || new Error('Could not start video source');
        }

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setError(null);
      } catch (err: any) {
        console.error('[ProjectorView] Failed to capture window stream:', err);
        if (isMounted) {
          const isSourceErr = err?.message?.includes('Could not start video source');
          setError(
            isSourceErr
              ? 'Não foi possível iniciar a captura deste aplicativo. Se a janela estiver minimizada, restaure-a no Windows. Você também pode usar a opção "Mover Janela" no painel principal.'
              : err?.message || 'Falha ao capturar a janela do aplicativo.'
          );
        }
      }
    }

    initCapture();
    resetHudTimer();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousemove', resetHudTimer);

    return () => {
      isMounted = false;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousemove', resetHudTimer);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [sourceId, displayId, retryTrigger]);

  return (
    <div className="w-screen h-screen bg-black overflow-hidden select-none relative flex items-center justify-center cursor-default">
      {/* Video stream container */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-contain bg-black"
      />

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-500 flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-white font-bold text-lg">Erro na Transmissão</h2>
          <p className="text-neutral-400 text-sm max-w-md">{error}</p>
          <div className="flex items-center space-x-3 pt-2">
            <button
              onClick={() => {
                setError(null);
                setRetryTrigger((prev) => prev + 1);
              }}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-mono text-xs uppercase font-bold transition cursor-pointer"
            >
              Tentar Novamente
            </button>
            <button
              onClick={handleClose}
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-mono text-xs uppercase cursor-pointer"
            >
              Fechar Transmissão (ESC)
            </button>
          </div>
        </div>
      )}

      {/* Floating Control HUD */}
      <div
        className={`absolute top-4 inset-x-0 mx-auto max-w-xl px-4 py-2.5 rounded-2xl bg-neutral-900/90 backdrop-blur-md border border-neutral-700/80 shadow-2xl flex items-center justify-between text-white transition-opacity duration-300 z-50 pointer-events-auto ${
          showHud ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center space-x-3 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-rose-400 font-bold">
                SpaceViewer Transmissor
              </span>
              <span className="text-[9px] font-mono text-neutral-400 border border-neutral-700 rounded px-1.5 py-0.2">
                Tela Cheia
              </span>
            </div>
            <span className="text-xs font-bold text-white truncate max-w-md">
              {appName || 'Aplicativo'}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          <span className="text-[10px] font-mono text-neutral-400 hidden sm:inline">
            Pressione <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 text-white font-bold">ESC</kbd> para fechar
          </span>
          <button
            onClick={handleClose}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer flex items-center space-x-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span>Fechar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
export default ProjectorView;
