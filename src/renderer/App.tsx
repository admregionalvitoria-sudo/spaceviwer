import React, { useEffect, useState } from 'react';
import type { InstallMode } from '../shared/types';
import { APP_VERSION } from '../shared/constants';
import MasterApp from './master/MasterApp';
import AgentApp from './agent/AgentApp';
import { TitleBar } from './components/ui/TitleBar';
import { GlassCard } from './components/ui/GlassCard';
import { ProjectorView } from './components/ProjectorView';
import neotycUrl from './assets/neotyc.png';
import nomespaceviewerUrl from './assets/nomespaceviewer.png';

export const App: React.FC = () => {
  // Check if running as a dedicated Projector window (via hash, search, or IPC fallback)
  const urlParams = new URLSearchParams(window.location.search || window.location.hash.replace(/^#\/?/, ''));
  const [projectorData, setProjectorData] = useState<{ sourceId: string; appName: string; displayId?: string } | null>(() => {
    const isProj = urlParams.get('projector') === 'true' || window.location.hash.includes('projector=true');
    const sId = urlParams.get('sourceId');
    if (isProj && sId) {
      return {
        sourceId: sId,
        appName: urlParams.get('appName') || 'Aplicativo',
        displayId: urlParams.get('displayId') || undefined,
      };
    }
    return null;
  });

  useEffect(() => {
    if (!projectorData && window.screenflow?.getProjectorParams) {
      window.screenflow.getProjectorParams().then((params) => {
        if (params && params.sourceId) {
          setProjectorData(params);
        }
      });
    }
  }, [projectorData]);

  if (projectorData) {
    return <ProjectorView sourceId={projectorData.sourceId} appName={projectorData.appName} displayId={projectorData.displayId} />;
  }

  const [installMode, setInstallMode] = useState<InstallMode | null>(null);
  const [selectedMode, setSelectedMode] = useState<'master' | 'agent' | null>(null);

  useEffect(() => {
    // Read the install mode from main process
    window.screenflow.getInstallMode().then((mode) => {
      setInstallMode(mode);
      if (mode === 'master') {
        setSelectedMode('master');
      } else if (mode === 'agent') {
        setSelectedMode('agent');
      }
    });
  }, []);

  const handleSelectMode = (mode: 'master' | 'agent') => {
    setSelectedMode(mode);
  };

  const handleResetMode = () => {
    // If the system is installed in "both" mode, allow returning to the launcher
    if (installMode === 'both') {
      setSelectedMode(null);
    }
  };

  if (!installMode) {
    return (
      <div className="h-screen w-screen flex flex-col justify-between bg-bg-space select-none">
        <TitleBar />
        <div className="flex-1 flex flex-col items-center justify-center space-y-4">
          <div className="w-10 h-10 border-4 border-neutral-200 border-t-neutral-800 rounded-full animate-spin" />
          <span className="font-mono text-xs text-neutral-500 uppercase tracking-wider">A carregar o SpaceViewer...</span>
        </div>
      </div>
    );
  }

  // Render Master UI
  if (selectedMode === 'master') {
    return (
      <div className="h-screen w-screen flex flex-col overflow-hidden relative">
        <MasterApp
          onResetMode={handleResetMode}
          canResetMode={installMode === 'both'}
        />
      </div>
    );
  }

  // Render Agent UI
  if (selectedMode === 'agent') {
    return (
      <div className="h-screen w-screen flex flex-col overflow-hidden relative">
        <AgentApp />
        {/* Float Launcher Button if in BOTH mode */}
        {installMode === 'both' && (
          <button
            onClick={handleResetMode}
            className="absolute bottom-4 left-4 z-50 px-3.5 py-2 rounded-xl bg-white hover:bg-neutral-100 text-[10px] font-bold font-mono uppercase tracking-wider text-neutral-600 hover:text-neutral-900 border border-neutral-300/60 transition duration-150 shadow-md cursor-pointer"
          >
            Voltar ao Inicializador
          </button>
        )}
      </div>
    );
  }

  // Render Launcher (Both mode selection page)
  return (
    <div className="h-screen w-screen flex flex-col bg-bg-space text-neutral-900 select-none overflow-hidden relative">
      <TitleBar subtitle="Inicializador" />

      {/* Grid Network Design Background */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 space-grid-bg relative">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-neutral-200/40 pointer-events-none" />

        <div className="text-center space-y-2 mb-8 max-w-md flex flex-col items-center justify-center">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-800 text-[10px] font-mono uppercase tracking-wider font-bold">
            SISTEMA HÍBRIDO (LAN & TV)
          </div>
          <img src={neotycUrl} alt="Neotyc" className="h-16 object-contain mt-4 mb-2 select-none" />
          <img src={nomespaceviewerUrl} alt="SpaceViewer" className="h-12 object-contain mb-4 select-none" />
          <p className="text-xs text-neutral-500 mt-2">
            Escolha o modo de funcionamento deste dispositivo.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl px-4">
          {/* Card 1: Master Mode */}
          <GlassCard
            onClick={() => handleSelectMode('master')}
            glowColor="none"
            className="p-8 text-center flex flex-col items-center justify-between group"
          >
            <div className="space-y-4">
              {/* Icon */}
              <div className="w-14 h-14 rounded-full bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-800 group-hover:scale-105 transition duration-300">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>

              <div>
                <h3 className="font-display font-bold text-lg text-neutral-900 group-hover:text-neutral-900 transition duration-200 uppercase tracking-wide">
                  Painel Transmissor (Master)
                </h3>
                <p className="text-xs text-neutral-600 mt-2 leading-relaxed">
                  Transmita a tela deste computador para receptores SpaceViewer locais ou Smart TVs com Moonlight.
                </p>
              </div>
            </div>

            <div className="mt-8 font-mono text-[10px] uppercase tracking-wider text-neutral-600 bg-neutral-100 border border-neutral-200 px-4 py-1.5 rounded-full">
              Iniciar Servidor WebRTC & GameStream
            </div>
          </GlassCard>

          {/* Card 2: Agent Mode */}
          <GlassCard
            onClick={() => handleSelectMode('agent')}
            glowColor="none"
            className="p-8 text-center flex flex-col items-center justify-between group"
          >
            <div className="space-y-4">
              {/* Icon */}
              <div className="w-14 h-14 rounded-full bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-800 group-hover:scale-105 transition duration-300">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>

              <div>
                <h3 className="font-display font-bold text-lg text-neutral-900 group-hover:text-neutral-900 transition duration-200 uppercase tracking-wide">
                  Receptor de Tela (Agent)
                </h3>
                <p className="text-xs text-neutral-600 mt-2 leading-relaxed">
                  Conecte este computador a um transmissor SpaceViewer na rede local para receber a tela.
                </p>
              </div>
            </div>

            <div className="mt-8 font-mono text-[10px] uppercase tracking-wider text-neutral-600 bg-neutral-100 border border-neutral-200 px-4 py-1.5 rounded-full">
              Sincronizar Receptor LAN
            </div>
          </GlassCard>
        </div>

        <div className="mt-12 text-[10px] text-neutral-500 font-mono">
          SPACEVIEWER SYSTEM V{APP_VERSION}
        </div>
      </div>
    </div>
  );
};
export default App;

