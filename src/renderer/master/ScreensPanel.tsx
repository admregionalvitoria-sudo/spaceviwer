// SpaceViewer v2.2.9
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GlassCard } from '../components/ui/GlassCard';
import type {
  AppWindowSource,
  DetailedScreenInfo,
  DisplayTopologyMode,
  SunshineStatus,
  VirtualDisplayStatus,
  VirtualDisplayState,
} from '../../shared/types';

export const ScreensPanel: React.FC = () => {
  const [screens, setScreens] = useState<DetailedScreenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayTopologyMode>('extended');
  const [isSwitchingTopology, setIsSwitchingTopology] = useState(false);
  const [moonlightStatus, setMoonlightStatus] = useState<SunshineStatus>('checking');
  const [virtualStatus, setVirtualStatus] = useState<VirtualDisplayStatus>({ installed: false, active: false });
  const [virtualState, setVirtualState] = useState<VirtualDisplayState>({
    installed: false,
    active: false,
    enabled: false,
    count: 1,
  });
  const [isUpdatingVirtual, setIsUpdatingVirtual] = useState(false);
  const [activatingVirtual, setActivatingVirtual] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // App Selection Modal / Drawer
  const [targetScreenForApp, setTargetScreenForApp] = useState<DetailedScreenInfo | null>(null);
  const [appWindows, setAppWindows] = useState<AppWindowSource[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [projectingScreenId, setProjectingScreenId] = useState<string | null>(null);

  // Context Menu State (Right-click on screens or grid)
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    screen?: DetailedScreenInfo;
  }>({ visible: false, x: 0, y: 0 });

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev));
  }, []);

  useEffect(() => {
    const handleClick = () => closeContextMenu();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeContextMenu]);

  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load all screens with rich previews and metadata
  const loadScreensData = useCallback(async (showIndicator = false) => {
    if (showIndicator) setRefreshing(true);
    try {
      const detailed = await window.screenflow.getScreensDetailed();
      setScreens(detailed || []);

      // Check moonlight host status
      const hs = await window.screenflow.checkSunshine();
      setMoonlightStatus(hs);

      // Check virtual display state & status
      try {
        const vState = await window.screenflow.getVirtualDisplayState();
        if (vState) {
          setVirtualState(vState);
          setVirtualStatus({
            installed: vState.installed,
            active: vState.active,
            enabled: vState.enabled,
            count: vState.count,
          });
        }
      } catch {
        const vdd = await window.screenflow.getVirtualDisplayStatus();
        setVirtualStatus(vdd);
      }
    } catch (err) {
      console.error('[ScreensPanel] Error loading screens:', err);
    } finally {
      setLoading(false);
      if (showIndicator) setRefreshing(false);
    }
  }, []);

  // Poll screens every 3 seconds to keep previews up to date and responsive
  useEffect(() => {
    loadScreensData();

    const unsub = window.screenflow.onScreensChanged(() => {
      console.log('[ScreensPanel] Screens changed event received');
      loadScreensData();
    });

    refreshTimerRef.current = setInterval(() => {
      loadScreensData(false);
    }, 3000);

    return () => {
      unsub();
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [loadScreensData]);

  // Handle topology switch (Extend vs Duplicate)
  const handleSetTopology = async (mode: DisplayTopologyMode) => {
    setIsSwitchingTopology(true);
    try {
      const result = await window.screenflow.setDisplayMode(mode);
      if (!result.success) throw new Error(result.error);
      setDisplayMode(mode);
      setActionMessage(mode === 'extended' ? 'Modo Estender ativado no Windows' : 'Modo Duplicar ativado no Windows');
      setTimeout(() => setActionMessage(null), 3000);
      await loadScreensData(true);
    } catch (err: any) {
      console.error('[ScreensPanel] Error setting display mode:', err);
      setActionMessage(err?.message || 'Erro ao alternar modo de exibição.');
    } finally {
      setIsSwitchingTopology(false);
    }
  };

  // Toggle Virtual Displays On / Off (Enable / Disable device)
  const handleToggleVirtualDisplays = async (enable: boolean) => {
    setIsUpdatingVirtual(true);
    try {
      const res = await window.screenflow.toggleVirtualDisplays(enable);
      if (res.success) {
        setActionMessage(
          enable
            ? 'Telas virtuais ativadas no Windows!'
            : 'Telas virtuais desativadas! O Windows está agora apenas com seu monitor físico.'
        );
        await loadScreensData(true);
      } else {
        setActionMessage(res.error || 'Não foi possível alterar as telas virtuais.');
      }
    } catch (err: any) {
      setActionMessage('Erro ao alternar telas virtuais.');
    } finally {
      setIsUpdatingVirtual(false);
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  // Add a Virtual Display (+1)
  const handleAddVirtualDisplay = async () => {
    setIsUpdatingVirtual(true);
    try {
      const res = await window.screenflow.addVirtualDisplay();
      if (res.success) {
        setActionMessage(`Tela virtual adicionada com sucesso! (${res.count} ${res.count === 1 ? 'tela ativa' : 'telas ativas'})`);
        await loadScreensData(true);
      } else {
        setActionMessage(res.error || 'Não foi possível adicionar tela virtual.');
      }
    } catch (err: any) {
      setActionMessage('Erro ao adicionar tela virtual.');
    } finally {
      setIsUpdatingVirtual(false);
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  // Remove a Virtual Display (-1)
  const handleRemoveVirtualDisplay = async () => {
    setIsUpdatingVirtual(true);
    try {
      const res = await window.screenflow.removeVirtualDisplay();
      if (res.success) {
        setActionMessage(
          res.count === 0
            ? 'Telas virtuais desativadas do Windows.'
            : `Tela virtual removida com sucesso! (${res.count} ${res.count === 1 ? 'tela restante' : 'telas restantes'})`
        );
        await loadScreensData(true);
      } else {
        setActionMessage(res.error || 'Não foi possível remover tela virtual.');
      }
    } catch (err: any) {
      setActionMessage('Erro ao remover tela virtual.');
    } finally {
      setIsUpdatingVirtual(false);
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  // Set explicit count (1, 2, 3, 4)
  const handleSetVirtualCount = async (count: number) => {
    setIsUpdatingVirtual(true);
    try {
      const res = await window.screenflow.setVirtualDisplayCount(count);
      if (res.success) {
        setActionMessage(`${count} ${count === 1 ? 'tela virtual configurada' : 'telas virtuais configuradas'} no Windows!`);
        await loadScreensData(true);
      } else {
        setActionMessage(res.error || 'Erro ao ajustar quantidade de telas.');
      }
    } catch (err: any) {
      setActionMessage('Erro ao configurar telas virtuais.');
    } finally {
      setIsUpdatingVirtual(false);
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  // Handle Activate / Install Virtual Display
  const handleActivateVirtualDisplay = async () => {
    setActivatingVirtual(true);
    try {
      const res = await window.screenflow.installVirtualDisplayDriver();
      if (res.success) {
        setActionMessage('Driver de monitor virtual ativado com sucesso!');
        await loadScreensData(true);
      } else {
        setActionMessage(res.error || 'Não foi possível ativar o driver virtual.');
      }
    } catch (err: any) {
      setActionMessage('Erro ao instalar driver virtual.');
    } finally {
      setActivatingVirtual(false);
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  // Open App Selector Modal for a specific screen
  const handleOpenAppSelector = async (screen: DetailedScreenInfo) => {
    setTargetScreenForApp(screen);
    setLoadingApps(true);
    setSearchFilter('');
    try {
      const windows = await window.screenflow.getAppWindows();
      setAppWindows(windows || []);
    } catch (err) {
      console.error('[ScreensPanel] Error loading app windows:', err);
    } finally {
      setLoadingApps(false);
    }
  };

  const handleRefreshAppWindows = async () => {
    setLoadingApps(true);
    try {
      const windows = await window.screenflow.getAppWindows();
      setAppWindows(windows || []);
    } catch (err) {
      console.error('[ScreensPanel] Error loading app windows:', err);
    } finally {
      setLoadingApps(false);
    }
  };

  // Project selected app onto target display
  const handleProjectApp = async (app: AppWindowSource) => {
    if (!targetScreenForApp) return;
    setProjectingScreenId(targetScreenForApp.displayId);
    try {
      const res = window.screenflow.startAppProjector
        ? await window.screenflow.startAppProjector(app.id, app.name, targetScreenForApp.displayId)
        : await window.screenflow.startObsProjector(app.id, app.name, targetScreenForApp.displayId);

      if (res.success) {
        setActionMessage(`Transmitindo "${app.name.slice(0, 30)}" na ${targetScreenForApp.name}`);
        setTargetScreenForApp(null);
        await loadScreensData(true);
      } else {
        setActionMessage(`Erro na transmissão: ${res.error}`);
      }
    } catch (err: any) {
      setActionMessage('Falha ao iniciar transmissão do aplicativo.');
    } finally {
      setProjectingScreenId(null);
      setTimeout(() => setActionMessage(null), 3500);
    }
  };

  // Move native window to target screen
  const handleMoveWindow = async (app: AppWindowSource) => {
    if (!targetScreenForApp) return;
    try {
      const res = await window.screenflow.moveWindowToScreen(app.name, targetScreenForApp.displayId, app.id);
      if (res.success) {
        setActionMessage(`Janela movida para ${targetScreenForApp.name}`);
        setTargetScreenForApp(null);
        await loadScreensData(true);
      } else {
        setActionMessage(`Não foi possível mover a janela: ${res.error}`);
      }
    } catch (err: any) {
      setActionMessage('Erro ao mover janela.');
    } finally {
      setTimeout(() => setActionMessage(null), 3500);
    }
  };

  // Stop projection on a display
  const handleStopProjection = async (displayId: string) => {
    try {
      if (window.screenflow.stopAppProjector) {
        await window.screenflow.stopAppProjector(displayId);
      } else {
        await window.screenflow.stopObsProjector(displayId);
      }
      setActionMessage('Transmissão encerrada.');
      await loadScreensData(true);
    } catch (err) {
      console.error('[ScreensPanel] Error stopping projector:', err);
    } finally {
      setTimeout(() => setActionMessage(null), 2500);
    }
  };

  // Set screen as the Moonlight broadcast target
  const handleSetMoonlightScreen = async (screen: DetailedScreenInfo) => {
    try {
      const res = await window.screenflow.setMoonlightScreen(screen.id);
      if (res.success) {
        setActionMessage(`Tela definida como transmissão do Moonlight!`);
        await loadScreensData(true);
      } else {
        setActionMessage(`Erro ao definir tela: ${res.error}`);
      }
    } catch (err) {
      setActionMessage('Erro ao configurar tela do Moonlight.');
    } finally {
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  const physicalCount = screens.filter((s) => s.isPrimary || !s.isVirtual).length;
  const virtualCount = screens.filter((s) => s.isVirtual).length;
  const projectingCount = screens.filter((s) => Boolean(s.projectedApp)).length;

  const filteredApps = appWindows.filter((w) =>
    w.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto pt-6 pb-12 px-6 space-y-6 space-grid-bg relative select-none">
      {/* Toast Action Message */}
      {actionMessage && (
        <div className="fixed top-14 right-6 z-50 px-4 py-2.5 rounded-xl bg-neutral-900/95 text-white border border-neutral-700 shadow-2xl flex items-center space-x-2.5 animate-in fade-in slide-in-from-top-2 duration-200">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-mono font-medium">{actionMessage}</span>
        </div>
      )}

      {/* Top Header & Connected Screens Counter */}
      <GlassCard className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center space-x-3 flex-wrap gap-y-1.5">
            <h2 className="font-display font-black text-2xl text-neutral-900 uppercase tracking-tight flex items-center space-x-2 py-1 leading-normal">
              <span>Gerenciador de Telas</span>
            </h2>

            {/* Total Connected Screens Counter Pill */}
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-neutral-900 text-white shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-mono font-black uppercase tracking-wider">
                {screens.length} {screens.length === 1 ? 'Tela Conectada' : 'Telas Conectadas'}
              </span>
            </div>

            {/* Moonlight Status Pill */}
            <div
              className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase border ${
                moonlightStatus === 'running'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-neutral-100 border-neutral-250 text-neutral-600'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  moonlightStatus === 'running' ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-400'
                }`}
              />
              <span>Moonlight: {moonlightStatus === 'running' ? 'Ativo (47989)' : 'Inativo'}</span>
            </div>
          </div>

          <p className="text-xs text-neutral-600 leading-relaxed max-w-3xl">
            Acompanhe o que cada tela está transmitindo em tempo real. Você pode estender telas físicas ou virtuais e transmitir qualquer aplicativo individual diretamente para a tela desejada.
          </p>

          {/* Breakdown Chips */}
          <div className="flex items-center space-x-2 pt-1 flex-wrap gap-y-1">
            <span className="text-[10px] font-mono uppercase tracking-wider bg-neutral-100 text-neutral-700 px-2.5 py-0.5 rounded-md border border-neutral-200">
              {physicalCount} {physicalCount === 1 ? 'Física (HDMI/DP)' : 'Físicas (HDMI/DP)'}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-md border border-indigo-200">
              {virtualCount} {virtualCount === 1 ? 'Virtual (Moonlight)' : 'Virtuais (Moonlight)'}
            </span>
            {projectingCount > 0 && (
              <span className="text-[10px] font-mono uppercase tracking-wider bg-cyan-50 text-cyan-800 px-2.5 py-0.5 rounded-md border border-cyan-200 animate-pulse">
                {projectingCount} Transmitindo App
              </span>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
          {/* Topology Toggle */}
          <div className="flex items-center bg-neutral-100 p-1 rounded-xl border border-neutral-250">
            <button
              onClick={() => handleSetTopology('extended')}
              disabled={isSwitchingTopology}
              className={`px-3 py-1.5 text-[10px] font-mono font-bold uppercase rounded-lg transition cursor-pointer ${
                displayMode === 'extended'
                  ? 'bg-neutral-900 text-white shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Estender
            </button>
            <button
              onClick={() => handleSetTopology('duplicate')}
              disabled={isSwitchingTopology}
              className={`px-3 py-1.5 text-[10px] font-mono font-bold uppercase rounded-lg transition cursor-pointer ${
                displayMode === 'duplicate'
                  ? 'bg-neutral-900 text-white shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Duplicar
            </button>
          </div>

          {/* Refresh Screens Button */}
          <button
            onClick={() => loadScreensData(true)}
            disabled={refreshing}
            className="px-3.5 py-2 text-xs font-mono font-bold uppercase rounded-xl border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-800 transition cursor-pointer flex items-center justify-center space-x-1.5 shadow-xs"
            title="Atualizar lista e previews de telas"
          >
            <svg
              className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-neutral-900' : 'text-neutral-600'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>{refreshing ? 'Atualizando...' : 'Atualizar'}</span>
          </button>
        </div>
      </GlassCard>

      {/* ── Seção de Gerenciamento de Telas Virtuais (SpaceviwerStream) ── */}
      <GlassCard className="p-5 border border-neutral-250 shadow-sm relative overflow-hidden bg-gradient-to-br from-white/95 via-white/80 to-indigo-50/40">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          {/* Info & Status */}
          <div className="space-y-1.5 max-w-xl">
            <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
              <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="font-display font-black text-lg text-neutral-900 tracking-tight uppercase">
                Telas Virtuais (SpaceviwerStream)
              </h3>

              {/* Status Badge */}
              {virtualState.enabled && (virtualState.active || virtualCount > 0) ? (
                <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Ativo • {virtualCount} {virtualCount === 1 ? 'tela virtual' : 'telas virtuais'} no Windows</span>
                </span>
              ) : (
                <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-neutral-100 text-neutral-600 border border-neutral-250">
                  <span className="w-2 h-2 rounded-full bg-neutral-400" />
                  <span>Desativado • Apenas monitor físico</span>
                </span>
              )}
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed">
              Adicione ou remova telas virtuais dinamicamente. Cada tela virtual criada pode ser selecionada para transmissão no Moonlight (Smart TV). Quando terminar, desative-as para liberar sua placa de vídeo e o cursor.
            </p>
          </div>

          {/* Controls Bar: Add, Remove, Toggle */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 shrink-0">
            {/* Stepper Buttons (- and +) */}
            <div className="flex items-center space-x-1 bg-white p-1 rounded-xl border border-neutral-250 shadow-2xs">
              <button
                onClick={handleRemoveVirtualDisplay}
                disabled={isUpdatingVirtual || (!virtualState.enabled && virtualCount === 0)}
                className="px-3.5 py-2 text-xs font-mono font-bold rounded-lg bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border border-neutral-200 transition cursor-pointer flex items-center space-x-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Remover uma tela virtual"
              >
                <svg className="w-3.5 h-3.5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20 12H4" />
                </svg>
                <span>Remover Tela</span>
              </button>

              <button
                onClick={handleAddVirtualDisplay}
                disabled={isUpdatingVirtual || (virtualState.enabled && virtualState.count >= 4)}
                className="px-3.5 py-2 text-xs font-mono font-bold rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition cursor-pointer flex items-center space-x-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Adicionar uma nova tela virtual"
              >
                <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
                </svg>
                <span>Adicionar Tela</span>
              </button>
            </div>

            {/* Toggle Switch Button */}
            <button
              onClick={() => handleToggleVirtualDisplays(!virtualState.enabled)}
              disabled={isUpdatingVirtual}
              className={`px-4 py-2 text-xs font-mono font-bold uppercase rounded-xl transition cursor-pointer flex items-center space-x-1.5 shadow-sm active:scale-[0.98] ${
                virtualState.enabled
                  ? 'bg-neutral-800 hover:bg-neutral-900 text-neutral-100 border border-neutral-700'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              {isUpdatingVirtual ? (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : virtualState.enabled ? (
                <svg className="w-3.5 h-3.5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              )}
              <span>{virtualState.enabled ? 'Desativar Telas' : 'Ativar Telas Virtuais'}</span>
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Large Preview Cards Grid */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 space-y-3">
          <div className="w-10 h-10 border-4 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
          <span className="font-mono text-xs uppercase text-neutral-500">Detectando telas e gerando previews...</span>
        </div>
      ) : screens.length === 0 ? (
        <GlassCard className="p-12 text-center flex flex-col items-center justify-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-400">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="font-display font-bold text-lg text-neutral-900 uppercase">Nenhuma tela encontrada</h3>
          <p className="text-xs text-neutral-500 max-w-sm">
            Verifique as conexões de vídeo ou clique no botão abaixo para forçar a re-detecção de monitores.
          </p>
          <button
            onClick={() => loadScreensData(true)}
            className="px-4 py-2 rounded-xl bg-neutral-900 text-white font-mono text-xs font-bold uppercase cursor-pointer"
          >
            Detectar Telas Novamente
          </button>
        </GlassCard>
      ) : (
        <div
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('.screen-card')) return;
            e.preventDefault();
            setContextMenu({ visible: true, x: e.clientX, y: e.clientY });
          }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 relative"
        >
          {screens.map((screen, idx) => {
            const isProjecting = Boolean(screen.projectedApp);

            return (
              <GlassCard
                key={screen.displayId || screen.id}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({ visible: true, x: e.clientX, y: e.clientY, screen });
                }}
                className="screen-card p-4 flex flex-col justify-between space-y-3 overflow-hidden border border-neutral-200/90 hover:border-neutral-400 transition-all duration-300 shadow-sm hover:shadow-md group relative rounded-2xl"
              >
                {/* Card Top Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-all ${
                        screen.isPrimary
                          ? 'bg-amber-50 border-amber-200 text-amber-700'
                          : screen.isVirtual
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                          : 'bg-neutral-100 border-neutral-250 text-neutral-800'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="2" y="3" width="20" height="14" rx="2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M8 21h8m-4-4v4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                        <h3 className="font-display font-bold text-sm text-neutral-900 truncate">
                          {screen.name}
                        </h3>

                        {/* Badges */}
                        {screen.isPrimary && (
                          <span className="px-1.5 py-0.5 rounded-md text-[8px] font-mono font-bold uppercase bg-amber-100 text-amber-900 border border-amber-300">
                            Principal
                          </span>
                        )}
                        {screen.isVirtual && (
                          <span className="px-1.5 py-0.5 rounded-md text-[8px] font-mono font-bold uppercase bg-indigo-100 text-indigo-900 border border-indigo-300">
                            Virtual MTT
                          </span>
                        )}
                        {screen.isMoonlightTarget && (
                          <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md text-[8px] font-mono font-bold uppercase bg-cyan-100 text-cyan-900 border border-cyan-300 animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-600" />
                            <span>Moonlight</span>
                          </span>
                        )}
                        {isProjecting && (
                          <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md text-[8px] font-mono font-bold uppercase bg-rose-100 text-rose-900 border border-rose-300 animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
                            <span>Ativo</span>
                          </span>
                        )}
                      </div>

                      <p className="text-[9px] font-mono text-neutral-500 mt-0.5 truncate">
                        {screen.size.width}×{screen.size.height} · {Math.round(screen.scaleFactor * 100)}% · ({screen.bounds.x}, {screen.bounds.y})
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5 shrink-0">
                    {screen.isVirtual && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveVirtualDisplay();
                        }}
                        disabled={isUpdatingVirtual}
                        className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded-md bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition cursor-pointer flex items-center space-x-1 shadow-2xs active:scale-95"
                        title="Reduzir a quantidade de telas virtuais no Windows"
                      >
                        <svg className="w-3 h-3 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span>Remover</span>
                      </button>
                    )}
                    <span className="font-mono text-[10px] font-black text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded border border-neutral-200">
                      #{idx + 1}
                    </span>
                  </div>
                </div>

                {/* Compact Live Preview Container */}
                <div className="w-full h-36 sm:h-40 rounded-xl bg-neutral-950 border border-neutral-300/80 overflow-hidden relative shadow-inner flex items-center justify-center group-hover:border-neutral-400 transition-all">
                  {screen.thumbnail ? (
                    <img
                      src={screen.thumbnail}
                      alt={screen.name}
                      className="w-full h-full object-contain select-none"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-neutral-500 space-y-1">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span className="text-[9px] font-mono uppercase">Aguardando feed</span>
                    </div>
                  )}

                  {/* Live Status Overlay */}
                  <div className="absolute top-2 left-2 z-10 flex items-center space-x-1 px-2 py-0.5 rounded-full bg-black/75 backdrop-blur-md border border-white/20 text-white font-mono text-[9px] uppercase font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Ao Vivo</span>
                  </div>

                  {/* Projected App Banner on Video */}
                  {isProjecting && screen.projectedApp && (
                    <div className="absolute bottom-2 inset-x-2 z-10 p-2 rounded-lg bg-neutral-900/90 backdrop-blur-md border border-neutral-700 text-white flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                        <span className="text-[11px] font-bold truncate">
                          {screen.projectedApp.appName}
                        </span>
                      </div>
                      <button
                        onClick={() => handleStopProjection(screen.displayId)}
                        className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded bg-rose-600 hover:bg-rose-700 text-white transition cursor-pointer shrink-0 ml-1"
                      >
                        Parar
                      </button>
                    </div>
                  )}
                </div>

                {/* Card Bottom Actions — MOVER JANELA COMO FUNÇÃO PRINCIPAL */}
                <div className="pt-2 border-t border-neutral-200/80 flex flex-col gap-2">
                  {/* Top row: Primary Action Button (Mover Janela) + Secondary (Espelhar) */}
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleOpenAppSelector(screen)}
                      className="flex-1 py-2 px-3 text-xs font-bold font-mono uppercase rounded-xl bg-neutral-900 hover:bg-neutral-800 active:scale-[0.98] text-white transition cursor-pointer flex items-center justify-center space-x-1.5 shadow-sm"
                      title="Mover uma janela de aplicativo aberta diretamente para esta tela"
                    >
                      <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      <span className="truncate">Mover Janela para cá</span>
                    </button>

                    <button
                      onClick={() => handleOpenAppSelector(screen)}
                      className="py-2 px-2.5 text-xs font-mono font-bold uppercase rounded-xl border border-neutral-300 hover:border-neutral-400 bg-white hover:bg-neutral-50 text-neutral-700 transition cursor-pointer flex items-center space-x-1 shadow-xs shrink-0"
                      title="Espelhar aplicativo em tela cheia via streaming"
                    >
                      <svg className="w-3.5 h-3.5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>{isProjecting ? 'Trocar' : 'Espelhar'}</span>
                    </button>
                  </div>

                  {/* Bottom row: Moonlight and Stop Projector */}
                  <div className="flex items-center justify-between gap-2">
                    {!screen.isMoonlightTarget ? (
                      <button
                        onClick={() => handleSetMoonlightScreen(screen)}
                        className="flex-1 py-1.5 px-2.5 text-[10px] font-mono font-bold uppercase rounded-lg border border-neutral-250 hover:border-neutral-400 bg-white hover:bg-neutral-50 text-neutral-700 transition cursor-pointer flex items-center justify-center space-x-1 shadow-2xs"
                        title="Transmitir o conteúdo desta tela no Moonlight para Smart TVs"
                      >
                        <svg className="w-3.5 h-3.5 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                          />
                        </svg>
                        <span>Definir no Moonlight</span>
                      </button>
                    ) : (
                      <span className="flex-1 py-1 px-2 text-[9px] font-mono font-bold uppercase rounded-lg bg-cyan-50 border border-cyan-300 text-cyan-800 flex items-center justify-center space-x-1">
                        <svg className="w-3 h-3 text-cyan-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                          />
                        </svg>
                        <span>Ativo no Moonlight</span>
                      </span>
                    )}

                    {isProjecting && (
                      <button
                        onClick={() => handleStopProjection(screen.displayId)}
                        className="py-1 px-2.5 text-[10px] font-mono font-bold uppercase rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-200 transition cursor-pointer flex items-center space-x-1 shrink-0"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <span>Parar</span>
                      </button>
                    )}
                  </div>
                </div>
              </GlassCard>
            );
          })}

          {/* Card Interativo: Adicionar Nova Tela Virtual */}
          <div
            onClick={() => {
              if (!isUpdatingVirtual && (!virtualState.enabled || virtualState.count < 4)) {
                handleAddVirtualDisplay();
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ visible: true, x: e.clientX, y: e.clientY });
            }}
            className={`screen-card p-6 flex flex-col items-center justify-center text-center space-y-4 rounded-2xl border-2 border-dashed transition-all duration-300 min-h-[300px] select-none ${
              isUpdatingVirtual || (virtualState.enabled && virtualState.count >= 4)
                ? 'border-neutral-250 bg-neutral-50/50 opacity-60 cursor-not-allowed'
                : 'border-indigo-300 hover:border-indigo-500 bg-gradient-to-b from-indigo-50/40 via-white/80 to-white hover:bg-indigo-50/70 shadow-xs hover:shadow-lg hover:scale-[1.01] cursor-pointer group'
            }`}
          >
            <div className="w-14 h-14 rounded-2xl bg-indigo-600 group-hover:bg-indigo-700 text-white flex items-center justify-center shadow-md group-hover:scale-110 transition-all">
              {isUpdatingVirtual ? (
                <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
                </svg>
              )}
            </div>

            <div className="space-y-1.5">
              <h3 className="font-display font-black text-base text-neutral-900 uppercase tracking-tight group-hover:text-indigo-600 transition-colors flex items-center justify-center space-x-1.5">
                <span>Adicionar Tela Virtual</span>
              </h3>
              <p className="text-xs text-neutral-500 max-w-[220px] leading-relaxed mx-auto">
                {virtualState.enabled && virtualState.count >= 4
                  ? 'Limite máximo de 4 telas virtuais atingido no Windows.'
                  : 'Criar novo monitor virtual no Windows para utilizar ou transmitir no Moonlight.'}
              </p>
            </div>

            <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-mono font-bold uppercase bg-indigo-100/80 text-indigo-900 border border-indigo-200">
              <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
              <span>{virtualCount} de 4 Telas Criadas</span>
            </div>
          </div>
        </div>
      )}

      {/* Application Selector Modal */}
      {targetScreenForApp && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-neutral-300 shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-5 border-b border-neutral-200 flex items-center justify-between bg-neutral-50/70">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-0.5 rounded-md bg-neutral-900 text-white font-mono text-[10px] font-black uppercase">
                    Mover Aplicativos & Janelas
                  </span>
                </div>
                <h3 className="font-display font-black text-xl text-neutral-900 uppercase">
                  Mover para: {targetScreenForApp.name}
                </h3>
                <p className="text-xs text-neutral-500">
                  Clique em <strong>Mover Janela</strong> para transferir a janela aberta diretamente para esta tela, ou em <strong>Espelhar</strong> para transmitir a visualização.
                </p>
              </div>

              <button
                onClick={() => setTargetScreenForApp(null)}
                className="p-2 rounded-xl text-neutral-400 hover:text-neutral-900 hover:bg-neutral-200/60 transition cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 border-b border-neutral-200 bg-white flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Buscar aplicativo ou janela aberta..."
                  className="w-full px-4 py-2.5 pl-10 rounded-xl bg-neutral-100 border border-neutral-300 text-neutral-900 placeholder-neutral-400 font-sans text-xs focus:outline-none focus:ring-2 focus:ring-neutral-900"
                />
                <svg
                  className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>

              <button
                onClick={handleRefreshAppWindows}
                disabled={loadingApps}
                className="px-3 py-2.5 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 font-mono text-xs font-bold uppercase transition flex items-center space-x-1.5 cursor-pointer shrink-0"
                title="Atualizar lista de janelas abertas no Windows"
              >
                <svg className={`w-3.5 h-3.5 text-neutral-600 ${loadingApps ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Atualizar</span>
              </button>
            </div>

            {/* App Windows Grid */}
            <div className="flex-1 overflow-y-auto p-5">
              {loadingApps ? (
                <div className="py-16 flex flex-col items-center justify-center space-y-3">
                  <div className="w-8 h-8 border-3 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
                  <span className="font-mono text-xs uppercase text-neutral-500">Listando janelas ativas...</span>
                </div>
              ) : filteredApps.length === 0 ? (
                <div className="py-12 text-center flex flex-col items-center justify-center space-y-3 text-neutral-600 max-w-md mx-auto">
                  <div className="w-12 h-12 rounded-2xl bg-neutral-100 border border-neutral-250 flex items-center justify-center text-neutral-400">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="font-sans text-sm font-semibold text-neutral-800">Nenhum aplicativo aberto encontrado.</p>
                  <span className="text-xs text-neutral-500 leading-relaxed">
                    Abra o aplicativo desejado (Chrome, Edge, WhatsApp, Excel, etc.) no Windows e clique no botão abaixo para atualizar. Janelas minimizadas na barra de tarefas também podem ser movidas.
                  </span>
                  <button
                    onClick={handleRefreshAppWindows}
                    className="mt-2 px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 active:scale-[0.98] text-white font-mono text-xs font-bold uppercase transition flex items-center space-x-1.5 shadow-sm cursor-pointer"
                  >
                    <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Atualizar Janelas do Windows</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {filteredApps.map((app) => (
                    <div
                      key={app.id}
                      className="p-3 rounded-2xl bg-neutral-50 border border-neutral-200 hover:border-neutral-400 transition flex flex-col justify-between space-y-2.5 shadow-xs hover:shadow-md group"
                    >
                      {/* App Window Thumbnail */}
                      <div className="w-full h-28 sm:h-32 rounded-xl bg-neutral-900 overflow-hidden relative border border-neutral-250 flex items-center justify-center">
                        {app.thumbnail ? (
                          <img src={app.thumbnail} alt={app.name} className="w-full h-full object-contain" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-neutral-500 text-xs font-mono">
                            Preview Indisponível
                          </div>
                        )}
                      </div>

                      {/* App Info */}
                      <div className="flex items-center space-x-2 min-w-0">
                        {app.appIcon ? (
                          <img src={app.appIcon} alt="" className="w-5 h-5 object-contain shrink-0" />
                        ) : (
                          <div className="w-5 h-5 rounded bg-neutral-200 flex items-center justify-center text-neutral-600 shrink-0">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2" />
                              <path d="M3 9h18M9 21V9" strokeWidth="2" />
                            </svg>
                          </div>
                        )}
                        <span className="font-bold text-xs text-neutral-900 truncate flex-1" title={app.name}>
                          {app.name}
                        </span>
                      </div>

                      {/* Action Buttons — MOVER JANELA como AÇÃO PRINCIPAL */}
                      <div className="flex items-center space-x-2 pt-1">
                        {/* Primary Button: Mover Janela */}
                        <button
                          onClick={() => handleMoveWindow(app)}
                          className="flex-1 py-2 px-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 active:scale-[0.98] text-white font-mono text-[11px] font-bold uppercase transition cursor-pointer flex items-center justify-center space-x-1.5 shadow-sm"
                          title="Mover a janela do aplicativo diretamente para esta tela"
                        >
                          <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                          <span className="truncate">Mover Janela</span>
                        </button>

                        {/* Secondary Button: Espelhar */}
                        <button
                          onClick={() => handleProjectApp(app)}
                          disabled={projectingScreenId !== null}
                          className="py-2 px-2.5 rounded-xl border border-neutral-300 hover:border-neutral-400 bg-white hover:bg-neutral-100 text-neutral-700 font-mono text-[10px] font-bold uppercase transition cursor-pointer flex items-center space-x-1 shadow-xs shrink-0"
                          title="Espelhar aplicativo em tela cheia via streaming"
                        >
                          <svg className="w-3 h-3 text-rose-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          <span>Espelhar</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between text-xs text-neutral-500">
              <span className="font-mono text-[10px]">
                {filteredApps.length} {filteredApps.length === 1 ? 'aplicativo disponível' : 'aplicativos disponíveis'}
              </span>
              <button
                onClick={() => setTargetScreenForApp(null)}
                className="px-4 py-1.5 rounded-xl border border-neutral-300 hover:bg-neutral-200/60 font-mono text-xs font-bold uppercase text-neutral-800 transition cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Menu de Contexto Flutuante (Botão Direito) */}
      {contextMenu.visible && (
        <div
          style={{
            top: `${Math.min(contextMenu.y, window.innerHeight - 200)}px`,
            left: `${Math.min(contextMenu.x, window.innerWidth - 240)}px`,
          }}
          className="fixed z-50 min-w-[230px] bg-white/95 backdrop-blur-md border border-neutral-300 rounded-2xl shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-100 text-neutral-800"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase text-neutral-400 border-b border-neutral-100 mb-1 flex items-center justify-between">
            <span>{contextMenu.screen ? contextMenu.screen.name : 'Gerenciar Telas'}</span>
            {contextMenu.screen?.isVirtual && (
              <span className="text-[8px] bg-indigo-50 text-indigo-700 px-1 py-0.2 rounded border border-indigo-200">
                Virtual
              </span>
            )}
          </div>

          <button
            onClick={() => {
              closeContextMenu();
              handleAddVirtualDisplay();
            }}
            disabled={isUpdatingVirtual || (virtualState.enabled && virtualState.count >= 4)}
            className="w-full text-left px-3 py-2 text-xs font-mono font-bold rounded-xl hover:bg-indigo-50 hover:text-indigo-700 flex items-center space-x-2.5 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <div className="w-5 h-5 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <span>Adicionar Tela Virtual</span>
          </button>

          {contextMenu.screen?.isVirtual && (
            <button
              onClick={() => {
                closeContextMenu();
                handleRemoveVirtualDisplay();
              }}
              disabled={isUpdatingVirtual}
              className="w-full text-left px-3 py-2 text-xs font-mono font-bold rounded-xl hover:bg-rose-50 hover:text-rose-700 flex items-center space-x-2.5 transition cursor-pointer disabled:opacity-40"
            >
              <div className="w-5 h-5 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <span>Remover Esta Tela</span>
            </button>
          )}

          {contextMenu.screen && !contextMenu.screen.isMoonlightTarget && (
            <button
              onClick={() => {
                if (contextMenu.screen) handleSetMoonlightScreen(contextMenu.screen);
                closeContextMenu();
              }}
              className="w-full text-left px-3 py-2 text-xs font-mono font-bold rounded-xl hover:bg-cyan-50 hover:text-cyan-700 flex items-center space-x-2.5 transition cursor-pointer"
            >
              <div className="w-5 h-5 rounded-lg bg-cyan-100 text-cyan-700 flex items-center justify-center shrink-0">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              </div>
              <span>Definir no Moonlight</span>
            </button>
          )}

          <div className="border-t border-neutral-150 my-1" />

          <button
            onClick={() => {
              closeContextMenu();
              loadScreensData(true);
            }}
            className="w-full text-left px-3 py-2 text-xs font-mono rounded-xl hover:bg-neutral-100 flex items-center space-x-2.5 transition cursor-pointer text-neutral-600"
          >
            <div className="w-5 h-5 rounded-lg bg-neutral-100 text-neutral-500 flex items-center justify-center shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <span>Atualizar Lista de Telas</span>
          </button>
        </div>
      )}

    </div>
  );
};
export default ScreensPanel;
