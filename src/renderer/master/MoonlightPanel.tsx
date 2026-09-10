// SpaceViewer v2.2.9
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GlassCard } from '../components/ui/GlassCard';
import type {
  DisplayTopologyMode,
  HostDisplayInfo,
  HostSettings,
  MoonlightClient,
  SmartTVDevice,
  SunshineStatus,
  SunshineStreamStats,
  VirtualDisplayStatus,
} from '../../shared/types';

// ============================================================
// Brand Icon & Badge Helper
// ============================================================

const BrandBadge: React.FC<{ brand: SmartTVDevice['brand']; type?: SmartTVDevice['type'] }> = ({ brand, type }) => {
  const getBrandDetails = () => {
    switch (brand) {
      case 'lg':
        return { label: 'LG webOS', color: 'bg-rose-500/10 text-rose-700 border-rose-200' };
      case 'samsung':
        return { label: 'Samsung Tizen', color: 'bg-blue-500/10 text-blue-700 border-blue-200' };
      case 'androidtv':
        return { label: 'Android TV / Google TV', color: 'bg-emerald-500/10 text-emerald-700 border-emerald-200' };
      case 'appletv':
        return { label: 'Apple TV / AirPlay', color: 'bg-neutral-500/10 text-neutral-800 border-neutral-200' };
      case 'firetv':
        return { label: 'Amazon Fire TV', color: 'bg-amber-500/10 text-amber-800 border-amber-200' };
      case 'roku':
        return { label: 'Roku OS', color: 'bg-purple-500/10 text-purple-700 border-purple-200' };
      case 'moonlight':
        return { label: 'Moonlight Client', color: 'bg-cyan-500/10 text-cyan-800 border-cyan-200' };
      default:
        return { label: type === 'streaming_box' ? 'Dispositivo de Streaming' : 'Smart TV', color: 'bg-neutral-100 text-neutral-700 border-neutral-200' };
    }
  };

  const { label, color } = getBrandDetails();

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider border ${color}`}>
      {label}
    </span>
  );
};

const BrandIcon: React.FC<{ brand: SmartTVDevice['brand']; isStreaming?: boolean }> = ({ brand, isStreaming }) => {
  return (
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border transition-all duration-300
      ${isStreaming
        ? 'bg-emerald-100 border-emerald-300 text-emerald-700 shadow-sm'
        : 'bg-neutral-100 border-neutral-250 text-neutral-800'}`}>
      {brand === 'appletv' ? (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      ) : brand === 'moonlight' ? (
        <svg className="w-5 h-5 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )}
    </div>
  );
};

// ============================================================
// TV Card Component
// ============================================================

const TVCard: React.FC<{
  device: SmartTVDevice;
  onPair: (device: SmartTVDevice) => void;
  onConnect: (device: SmartTVDevice) => void;
  onRemove?: (uuid: string) => void;
}> = ({ device, onPair, onConnect, onRemove }) => {
  const [actionLoading, setActionLoading] = useState(false);

  const handleConnectClick = async () => {
    setActionLoading(true);
    await onConnect(device);
    setActionLoading(false);
  };

  return (
    <div className="p-4 rounded-xl bg-white/70 border border-neutral-200/80 hover:border-neutral-350 transition-all duration-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 group">
      <div className="flex items-center space-x-3.5 min-w-0">
        <BrandIcon brand={device.brand} isStreaming={device.status === 'streaming'} />
        <div className="min-w-0">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <h4 className="text-xs font-bold text-neutral-900 truncate">{device.name}</h4>
            <BrandBadge brand={device.brand} type={device.type} />
            {device.status === 'streaming' && (
              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[9px] font-mono font-black uppercase bg-emerald-100 border border-emerald-300 text-emerald-800 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                <span>Transmitindo</span>
              </span>
            )}
          </div>
          <p className="text-[10px] font-mono text-neutral-500 truncate mt-0.5">
            IP: {device.ip} {device.model ? `· Modelo: ${device.model}` : ''}
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2.5 shrink-0 self-end sm:self-center">
        {device.isMoonlightPaired ? (
          <>
            <span className="text-[9px] font-mono uppercase px-2.5 py-1 rounded-full border tracking-wider font-semibold text-neutral-800 bg-neutral-100 border-neutral-250">
              Pareado
            </span>
            <button
              onClick={handleConnectClick}
              disabled={actionLoading}
              className="px-3.5 py-1.5 text-xs font-bold font-mono uppercase rounded-lg bg-neutral-900 text-white hover:bg-neutral-800 active:scale-[0.98] transition cursor-pointer flex items-center space-x-1.5 shadow-sm"
            >
              {actionLoading ? (
                <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  </svg>
                  <span>Transmitir</span>
                </>
              )}
            </button>
            {device.clientUuid && onRemove && (
              <button
                onClick={() => onRemove(device.clientUuid!)}
                className="p-1.5 text-neutral-400 hover:text-rose-600 rounded-lg hover:bg-neutral-100 transition"
                title="Desconectar"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </>
        ) : (
          <button
            onClick={() => onPair(device)}
            className="px-3.5 py-1.5 text-xs font-bold font-mono uppercase rounded-lg border border-neutral-350 bg-white hover:bg-neutral-100 text-neutral-900 hover:border-neutral-500 active:scale-[0.98] transition cursor-pointer flex items-center space-x-1.5 shadow-sm"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span>Parear PIN</span>
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================
// Main Panel Component
// ============================================================

export const MoonlightPanel: React.FC = () => {
  // --- Native Host State ---
  const [hostStatus, setHostStatus] = useState<SunshineStatus>('checking');
  const [isToggling, setIsToggling] = useState(false);

  // --- Display Mode & Virtual Display Driver ---
  const [displayMode, setDisplayModeState] = useState<DisplayTopologyMode>('extended');
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);
  const [driverStatus, setDriverStatus] = useState<VirtualDisplayStatus>({ installed: false, active: false });
  const [installingDriver, setInstallingDriver] = useState(false);
  const [driverMessage, setDriverMessage] = useState<string | null>(null);

  // --- Host Displays & Stream Settings ---
  const [displays, setDisplays] = useState<HostDisplayInfo[]>([]);
  const [settings, setSettings] = useState<HostSettings>({
    display: 0,
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateMbps: 20,
    hardware: true,
    virtualDisplay: true,
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSavedMessage, setSettingsSavedMessage] = useState<string | null>(null);

  // --- Smart TVs & Devices ---
  const [smartTVs, setSmartTVs] = useState<SmartTVDevice[]>([]);
  const [isScanningTVs, setIsScanningTVs] = useState(false);

  // --- PIN Pairing ---
  const [pin, setPin] = useState('');
  const [pairingTarget, setPairingTarget] = useState<string | null>(null);
  const [pairingStatus, setPairingStatus] = useState<'idle' | 'pairing' | 'success' | 'error'>('idle');
  const [pairingError, setPairingError] = useState<string | null>(null);

  // --- Live Stats ---
  const [streamStats, setStreamStats] = useState<SunshineStreamStats | null>(null);

  // --- Paired Clients ---
  const [clients, setClients] = useState<MoonlightClient[]>([]);

  // --- Network IPs ---
  const [localIps, setLocalIps] = useState<string[]>([]);

  // --- Incoming Pairing Request Banner ---
  const [incomingRequest, setIncomingRequest] = useState<string | null>(null);

  // --- Active Tab ---
  const [activeSection, setActiveSection] = useState<'tvs' | 'display' | 'pairing' | 'guides'>('tvs');

  // --- Host Info (Hostname & IP) ---
  const [hostInfo, setHostInfo] = useState<{ hostname: string; rawHostname: string; ip: string } | null>(null);
  const autoStartAttemptedRef = useRef(false);
  const userManuallyStoppedRef = useRef(false);

  const statsUnsubRef = useRef<(() => void) | null>(null);

  // ---- Load Host Displays, Settings & Driver Status ----
  const refreshHostData = useCallback(async () => {
    try {
      const [driver, hostDisplays, hostSets] = await Promise.all([
        window.screenflow.getVirtualDisplayStatus(),
        window.screenflow.getHostDisplays(),
        window.screenflow.getHostSettings(),
      ]);

      setDriverStatus(driver);
      if (hostDisplays && hostDisplays.length > 0) setDisplays(hostDisplays);
      if (hostSets) {
        setSettings(hostSets);
        setDisplayModeState(hostSets.virtualDisplay ? 'extended' : 'duplicate');
      }
    } catch (err) {
      console.error('[MoonlightPanel] Error loading host data:', err);
    }
  }, []);

  // ---- Initial Load ----
  useEffect(() => {
    checkHostStatus();
    loadClients();
    scanSmartTVs();
    refreshHostData();

    window.screenflow.getNetworkAddresses().then((ips) => setLocalIps(ips || []));
    window.screenflow.getHostInfo?.().then((info) => {
      if (info) setHostInfo(info);
    }).catch(() => {});

    // Listen for GameStream status changes
    const unsubStatus = window.screenflow.onGameStreamStatus((status) => {
      setHostStatus(status === 'running' ? 'running' : 'stopped');
      if (status === 'running') {
        refreshHostData();
      }
    });

    // Listen for real-time stream stats pushed from main process
    statsUnsubRef.current = window.screenflow.onMoonlightStreamStats((stats) => {
      setStreamStats(stats);
      if (stats.displayMode) {
        setDisplayModeState(stats.displayMode);
      }
    });

    // Listen for discovered TVs updates
    const unsubTVs = window.screenflow.onSmartTVsUpdated((tvs) => {
      if (tvs && Array.isArray(tvs)) {
        setSmartTVs(tvs);
      }
    });

    // Listen for incoming pairing request directly from Moonlight on TV
    const unsubPairingReq = window.screenflow.onMoonlightPairingRequested((info) => {
      console.log('Incoming Moonlight pairing request:', info);
      setIncomingRequest(info?.name || 'Smart TV');
      setActiveSection('pairing');
      setTimeout(() => {
        const input = document.getElementById('moonlight-pin-input') as HTMLInputElement;
        if (input) input.focus();
      }, 200);
    });

    // Periodically poll status and scan
    const statusInterval = setInterval(checkHostStatus, 8000);
    const tvInterval = setInterval(scanSmartTVs, 25000);

    return () => {
      unsubStatus();
      if (statsUnsubRef.current) statsUnsubRef.current();
      unsubTVs();
      unsubPairingReq();
      clearInterval(statusInterval);
      clearInterval(tvInterval);
    };
  }, [refreshHostData]);

  const checkHostStatus = async () => {
    try {
      const status = await window.screenflow.checkSunshine();
      setHostStatus(status);
      if (status === 'stopped' && !userManuallyStoppedRef.current && !autoStartAttemptedRef.current) {
        autoStartAttemptedRef.current = true;
        console.log('[MoonlightPanel] Host is stopped on launch, auto-starting Moonlight host...');
        window.screenflow.startGameStream().then((started) => {
          if (started) {
            setHostStatus('running');
            refreshHostData();
          }
        }).catch(() => {});
      }
    } catch {
      setHostStatus('stopped');
    }
  };

  const scanSmartTVs = async () => {
    setIsScanningTVs(true);
    try {
      const tvs = await window.screenflow.discoverSmartTVs();
      if (tvs) setSmartTVs(tvs);
    } catch (err) {
      console.error('Error discovering TVs:', err);
    } finally {
      setIsScanningTVs(false);
    }
  };

  const loadClients = async () => {
    try {
      const list = await window.screenflow.getMoonlightClients();
      setClients(list || []);
    } catch {
      setClients([]);
    }
  };

  // ---- Server Toggle ----
  const handleToggleHost = async () => {
    if (isToggling) return;
    setIsToggling(true);
    try {
      if (hostStatus === 'running') {
        userManuallyStoppedRef.current = true;
        await window.screenflow.stopGameStream();
        setHostStatus('stopped');
        setStreamStats(null);
      } else {
        userManuallyStoppedRef.current = false;
        const success = await window.screenflow.startGameStream();
        if (success) {
          setHostStatus('running');
          await refreshHostData();
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsToggling(false);
    }
  };

  // ---- Switch Display Mode (Extend vs Duplicate) ----
  const handleSwitchDisplayMode = async (mode: DisplayTopologyMode) => {
    if (isSwitchingMode) return;
    setIsSwitchingMode(true);
    try {
      setDisplayModeState(mode);
      const res = await window.screenflow.setDisplayMode(mode);
      if (res.success) {
        await window.screenflow.setHostSettings({
          virtualDisplay: mode === 'extended',
          display: 0,
        });
        setSettings((prev) => ({ ...prev, virtualDisplay: mode === 'extended', display: 0 }));
        setSettingsSavedMessage(
          mode === 'duplicate'
            ? 'Modo Duplicar (Espelho) ativado! A tela principal do computador está sendo espelhada na TV.'
            : 'Modo Estender ativado! A TV funciona como uma 2ª tela virtual independente.'
        );
        setTimeout(() => setSettingsSavedMessage(null), 4000);
        await refreshHostData();
      } else {
        alert(res.error || 'Não foi possível alterar a topologia de tela no Windows.');
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao alterar modo de tela.');
    } finally {
      setIsSwitchingMode(false);
    }
  };

  // ---- Install Virtual Display Driver ----
  const handleInstallDriver = async () => {
    setInstallingDriver(true);
    setDriverMessage(null);
    try {
      const res = await window.screenflow.installVirtualDisplayDriver();
      if (res.success) {
        setDriverStatus({ installed: true, active: true });
        setDriverMessage(
          res.rebootRequired
            ? 'Driver instalado com sucesso! Pode ser necessário reiniciar o Windows para concluir.'
            : 'Driver de Monitor Virtual instalado e ativo com sucesso!'
        );
        await refreshHostData();
      } else {
        setDriverMessage(res.error || 'Falha ao instalar o driver.');
      }
    } catch (err: any) {
      setDriverMessage(err.message || 'Erro durante a instalação.');
    } finally {
      setInstallingDriver(false);
    }
  };

  // ---- Save Stream Settings ----
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    setSettingsSavedMessage(null);
    try {
      const res = await window.screenflow.setHostSettings(settings);
      if (res.success) {
        setSettingsSavedMessage('Configurações aplicadas na transmissão com sucesso!');
        setTimeout(() => setSettingsSavedMessage(null), 3000);
      } else {
        setSettingsSavedMessage(res.error || 'Erro ao salvar configurações.');
      }
    } catch (err: any) {
      setSettingsSavedMessage(err.message || 'Falha ao aplicar.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // ---- Quick Connect to TV ----
  const handleConnectToTV = async (device: SmartTVDevice) => {
    if (hostStatus !== 'running') {
      const ok = await window.screenflow.startGameStream();
      if (ok) setHostStatus('running');
    }
    if (!device.isMoonlightPaired) {
      setPairingTarget(device.name);
      setActiveSection('pairing');
    }
  };

  // ---- Prompt PIN for Target TV ----
  const handlePromptPair = (device: SmartTVDevice) => {
    setPairingTarget(device.name);
    setActiveSection('pairing');
  };

  // ---- PIN Pairing ----
  const handlePairPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || pin.length !== 4) return;
    setPairingStatus('pairing');
    setPairingError(null);
    try {
      const res = await window.screenflow.pairMoonlightPin(pin);
      if (res.success) {
        setPairingStatus('success');
        setPin('');
        setPairingTarget(null);
        setIncomingRequest(null);
        setTimeout(() => setPairingStatus('idle'), 5000);
        setTimeout(() => {
          loadClients();
          scanSmartTVs();
        }, 1500);
      } else {
        setPairingStatus('error');
        setPairingError(res.error || 'Erro de pareamento. Verifique o PIN na TV.');
      }
    } catch (err: any) {
      setPairingStatus('error');
      setPairingError(err.message || 'Falha de comunicação com o host.');
    }
  };

  // ---- Remove Client ----
  const handleRemoveClient = async (uuid: string) => {
    const result = await window.screenflow.removeMoonlightClient(uuid);
    if (result.success) {
      setClients((prev) => prev.filter((c) => c.uuid !== uuid));
      scanSmartTVs();
    }
  };

  const isStreaming = streamStats?.isStreaming ?? false;
  const uptimeFormatted = streamStats?.uptime
    ? `${String(Math.floor(streamStats.uptime / 3600)).padStart(2, '0')}:${String(Math.floor((streamStats.uptime % 3600) / 60)).padStart(2, '0')}:${String(streamStats.uptime % 60).padStart(2, '0')}`
    : '00:00:00';

  return (
    <div className="h-full flex flex-col p-5 space-y-5 overflow-y-auto select-none space-grid-bg relative text-neutral-900">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-neutral-200/40 pointer-events-none" />

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-neutral-200/60 pb-4 shrink-0">
        <div>
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-800 text-[10px] font-mono uppercase tracking-wider mb-2 font-bold">
            HOST NATIVO & EXTENSOR MOONLIGHT
          </div>
          <h2 className="font-display font-black text-2xl text-neutral-900 uppercase tracking-wide">
            Transmissão Moonlight & Extensor de Tela
          </h2>
          <p className="text-xs text-neutral-600 mt-0.5">
            Use sua Smart TV ou tablet como uma <strong>segunda tela estendida independente</strong> sem bloquear sua área de trabalho.
          </p>
        </div>

        {/* Server Status + Toggle */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center space-x-2">
            <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider font-mono bg-neutral-100 border border-neutral-250 text-neutral-800">
              <span className={`h-1.5 w-1.5 rounded-full ${hostStatus === 'running' || isStreaming ? 'bg-emerald-600' : 'bg-neutral-400'}`} />
              <span>
                {isStreaming ? `Streaming Ativo (${streamStats?.fps || 60} FPS)`
                 : hostStatus === 'running' ? 'Host Ativo (Pronto)'
                 : hostStatus === 'stopped' ? 'Host Parado'
                 : 'Verificando...'}
              </span>
            </span>

            {/* Display Mode Badge */}
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold font-mono uppercase tracking-wider border
              ${displayMode === 'extended'
                ? 'bg-emerald-500/10 text-emerald-800 border-emerald-300'
                : 'bg-amber-500/10 text-amber-800 border-amber-300'}`}>
              {displayMode === 'extended' ? (
                <span className="flex items-center space-x-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="2" y="4" width="12" height="9" rx="1.5" strokeWidth="2" />
                    <path d="M6 17h4m-2-4v4" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span>Tela Estendida</span>
                </span>
              ) : (
                <span className="flex items-center space-x-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="2" y="3" width="13" height="10" rx="2" strokeWidth="2" />
                    <rect x="9" y="8" width="13" height="10" rx="2" strokeWidth="2" />
                  </svg>
                  <span>Tela Duplicada</span>
                </span>
              )}
            </span>
          </div>

          <button
            onClick={handleToggleHost}
            disabled={isToggling || hostStatus === 'checking'}
            id="gamestream-toggle-btn"
            className={`px-4 py-2 rounded-xl text-xs font-bold font-mono tracking-wide transition duration-150 shadow-md flex items-center space-x-2 cursor-pointer disabled:opacity-50
              ${hostStatus === 'running'
                ? 'bg-neutral-100 border border-neutral-200 hover:bg-neutral-200 text-neutral-800'
                : 'bg-neutral-900 text-white hover:bg-neutral-800'}`}
          >
            {isToggling ? (
              <div className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
            ) : hostStatus === 'running' ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                <span>Parar Host</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                </svg>
                <span>Iniciar Host</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Virtual Display Driver Alert (if not installed) ── */}
      {!driverStatus.installed && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-amber-200/80 text-amber-900 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-amber-900">
                Driver de Monitor Virtual Não Detectado
              </h4>
              <p className="text-xs text-amber-800 mt-0.5">
                Para estender a tela (criar um 2º monitor virtual sem espelhar sua tela principal), instale o driver MTT VDD integrado.
              </p>
            </div>
          </div>
          <button
            onClick={handleInstallDriver}
            disabled={installingDriver}
            className="px-4 py-2 bg-amber-900 text-white hover:bg-amber-850 rounded-lg text-xs font-bold font-mono tracking-wider uppercase transition shadow-sm cursor-pointer disabled:opacity-50 shrink-0 flex items-center space-x-2"
          >
            {installingDriver ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Instalando...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Instalar Driver com 1 Clique</span>
              </>
            )}
          </button>
        </div>
      )}

      {driverMessage && (
        <div className="p-3 bg-neutral-100 border border-neutral-300 rounded-xl text-xs font-mono text-neutral-800">
          {driverMessage}
        </div>
      )}

      {/* ── Live Streaming Stats Bar ── */}
      {hostStatus === 'running' && (
        <GlassCard className="p-4 shrink-0 transition-all duration-500">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3.5 flex-1">
              <div className="w-9 h-9 rounded-full flex items-center justify-center border shrink-0 bg-neutral-100 border-neutral-200">
                <svg className={`w-4.5 h-4.5 ${isStreaming ? 'text-emerald-600' : 'text-neutral-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-bold text-neutral-900 uppercase tracking-wider font-mono">
                  {isStreaming ? 'Transmissão em Andamento' : 'Host Pronto para Conexão'}
                </p>
                <p className="text-[10px] text-neutral-600 font-mono mt-0.5">
                  {isStreaming
                    ? `${streamStats?.activeClients ?? 0} cliente(s) conectado(s) · ${streamStats?.encoder ?? 'GPU Hardware'} · Modo: ${displayMode === 'extended' ? 'Tela Estendida' : 'Tela Duplicada'} · Tempo: ${uptimeFormatted}`
                    : `Disponível na rede local (${localIps[0] || '127.0.0.1'})`}
                </p>
              </div>
            </div>

            {/* Dashboard Stats */}
            <div className="flex items-center space-x-4 border-l border-neutral-200/60 pl-4 font-mono">
              <div className="flex items-center space-x-5">
                <div className="flex flex-col">
                  <span className="text-[9px] text-neutral-500 uppercase tracking-wider">FPS</span>
                  <span className="text-lg font-black text-neutral-900">{isStreaming ? String(streamStats?.fps ?? 60) : '—'}</span>
                </div>
                <div className="h-6 w-px bg-neutral-200" />
                <div className="flex flex-col">
                  <span className="text-[9px] text-neutral-500 uppercase tracking-wider">Bitrate</span>
                  <span className="text-lg font-black text-neutral-900">
                    {isStreaming ? String(Math.round((streamStats?.bitrate ?? 0) / 1000)) : '—'}
                    {isStreaming && <span className="text-[10px] font-normal opacity-60 ml-0.5"> Mbps</span>}
                  </span>
                </div>
                <div className="h-6 w-px bg-neutral-200" />
                <div className="flex flex-col">
                  <span className="text-[9px] text-neutral-500 uppercase tracking-wider">Resolução</span>
                  <span className="text-lg font-black text-neutral-900">
                    {isStreaming ? `${streamStats?.resolution?.width ?? 1920}×${streamStats?.resolution?.height ?? 1080}` : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* ── Section Tabs ── */}
      <div className="flex space-x-1 bg-neutral-100 rounded-xl p-1 border border-neutral-200 shrink-0">
        {[
          {
            id: 'tvs' as const,
            label: `Smart TVs & Dispositivos (${smartTVs.length})`,
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            )
          },
          {
            id: 'display' as const,
            label: 'Extensor de Tela & Resolução',
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            )
          },
          {
            id: 'pairing' as const,
            label: 'Pareamento PIN',
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            )
          },
          {
            id: 'guides' as const,
            label: 'Como Instalar na TV',
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            )
          },
        ].map((tab) => (
          <button
            key={tab.id}
            id={`moonlight-tab-${tab.id}`}
            onClick={() => setActiveSection(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold font-mono transition-all duration-150 cursor-pointer
              ${activeSection === tab.id
                ? 'bg-white text-neutral-900 border border-neutral-200 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-900 hover:bg-white/50'}`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── Section: Smart TVs na Rede ── */}
      {activeSection === 'tvs' && (
        <div className="flex-1 flex flex-col gap-4">
          <GlassCard className="p-5 flex-1 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-200/60 pb-3">
              <div>
                <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-wider font-mono">
                  Smart TVs e Dispositivos Detectados na Rede
                </h3>
                <p className="text-[11px] text-neutral-600 mt-0.5">
                  Identifica automaticamente TVs LG webOS, Samsung Tizen, Android TV, Apple TV e clientes Moonlight na mesma rede Wi-Fi/Ethernet.
                </p>
              </div>

              <button
                onClick={scanSmartTVs}
                disabled={isScanningTVs}
                className="px-3.5 py-2 rounded-xl text-xs font-bold font-mono tracking-wider border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-800 flex items-center space-x-2 cursor-pointer shadow-sm disabled:opacity-50 self-start sm:self-auto shrink-0"
              >
                <svg className={`w-4 h-4 ${isScanningTVs ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18" />
                </svg>
                <span>{isScanningTVs ? 'Escaneando Rede...' : 'Buscar TVs na Rede'}</span>
              </button>
            </div>

            {/* TV list or empty state */}
            {smartTVs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-neutral-100 border border-neutral-200 flex items-center justify-center relative">
                  <svg className="w-8 h-8 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  {isScanningTVs && (
                    <div className="absolute inset-0 rounded-full border-2 border-neutral-900 border-t-transparent animate-spin" />
                  )}
                </div>
                <div className="max-w-md">
                  <p className="text-sm font-bold text-neutral-800 font-mono">NENHUMA SMART TV DETECTADA AINDA</p>
                  <p className="text-xs text-neutral-500 font-mono mt-1.5 leading-relaxed">
                    Certifique-se de que sua Smart TV está ligada e conectada na mesma rede deste computador. Se já abriu o Moonlight na TV, clique em <span className="font-bold text-neutral-800">Buscar TVs na Rede</span> ou use a aba <span className="font-bold text-neutral-800">Pareamento PIN</span>.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 flex-1 overflow-y-auto">
                {smartTVs.map((dev) => (
                  <TVCard
                    key={dev.id}
                    device={dev}
                    onPair={handlePromptPair}
                    onConnect={handleConnectToTV}
                    onRemove={handleRemoveClient}
                  />
                ))}
              </div>
            )}

            {/* Host info box */}
            <div className="p-3 bg-neutral-50 border border-neutral-200/80 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center flex-wrap gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="font-bold text-neutral-800">Nome no Moonlight:</span>
                <span className="font-mono font-black text-neutral-900 bg-white px-2 py-0.5 rounded border border-neutral-250 shadow-2xs">
                  {hostInfo?.hostname || 'Buscando host...'}
                </span>
                <span className="text-neutral-400">·</span>
                <span className="font-bold text-neutral-800">IP deste PC:</span>
                <span className="font-mono font-black text-neutral-900 bg-white px-2 py-0.5 rounded border border-neutral-250 shadow-2xs">
                  {hostInfo?.ip || localIps[0] || '127.0.0.1'}
                </span>
              </div>
              <span className="text-[10px] text-neutral-500 shrink-0">Host Nativo SpaceviwerStream · Portas: 47989 / 47984 / 48010</span>
            </div>
          </GlassCard>
        </div>
      )}

      {/* ── Section: Tela Virtual & Extensor de Tela ── */}
      {activeSection === 'display' && (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Display Mode Choice & Screen Art */}
          <div className="lg:col-span-3 flex flex-col gap-5">
            <GlassCard className="p-6 space-y-6">
              <div>
                <span className="text-[10px] uppercase font-mono tracking-wider text-neutral-500">Topologia de Exibição</span>
                <h3 className="text-base font-bold text-neutral-900 uppercase tracking-wider font-mono mt-0.5">
                  Modo de Transmissão de Tela
                </h3>
                <p className="text-xs text-neutral-600 mt-1 leading-relaxed">
                  Escolha se deseja transformar a TV em um <strong>monitor estendido independente</strong> ou apenas espelhar a tela do seu computador.
                </p>
              </div>

              {/* Segmented Mode Picker */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => handleSwitchDisplayMode('extended')}
                  disabled={isSwitchingMode}
                  className={`p-4 rounded-xl border text-left transition-all duration-200 cursor-pointer flex flex-col justify-between space-y-3
                    ${displayMode === 'extended'
                      ? 'bg-neutral-900 text-white border-neutral-900 shadow-md ring-2 ring-neutral-900/10'
                      : 'bg-white hover:bg-neutral-50 text-neutral-800 border-neutral-300'}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-neutral-400">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="2" y="4" width="12" height="9" rx="1.5" strokeWidth="2" />
                        <path d="M6 17h4m-2-4v4" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
                      </svg>
                      <svg className="w-6 h-6 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="2" y="4" width="14" height="10" rx="2" strokeWidth="2" />
                        <path d="M7 18h4m-2-4v4" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </div>
                    {displayMode === 'extended' && (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase bg-emerald-500 text-white">
                        Ativo
                      </span>
                    )}
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase font-mono tracking-wider">
                      Estender Tela (Recomendado)
                    </h4>
                    <p className={`text-[11px] mt-1 leading-relaxed ${displayMode === 'extended' ? 'text-neutral-300' : 'text-neutral-500'}`}>
                      Cria uma segunda tela virtual no Windows. Seu monitor principal fica livre para trabalho local enquanto a TV exibe conteúdos independentes.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSwitchDisplayMode('duplicate')}
                  disabled={isSwitchingMode}
                  className={`p-4 rounded-xl border text-left transition-all duration-200 cursor-pointer flex flex-col justify-between space-y-3
                    ${displayMode === 'duplicate'
                      ? 'bg-neutral-900 text-white border-neutral-900 shadow-md ring-2 ring-neutral-900/10'
                      : 'bg-white hover:bg-neutral-50 text-neutral-800 border-neutral-300'}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-neutral-400">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="2" y="4" width="12" height="9" rx="1.5" strokeWidth="2" />
                        <path d="M6 17h4m-2-4v4" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 9h16M4 15h16" />
                      </svg>
                      <svg className="w-6 h-6 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="2" y="4" width="12" height="9" rx="1.5" strokeWidth="2" />
                        <path d="M6 17h4m-2-4v4" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </div>
                    {displayMode === 'duplicate' && (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase bg-emerald-500 text-white">
                        Ativo
                      </span>
                    )}
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase font-mono tracking-wider">
                      Duplicar Tela (Espelho)
                    </h4>
                    <p className={`text-[11px] mt-1 leading-relaxed ${displayMode === 'duplicate' ? 'text-neutral-300' : 'text-neutral-500'}`}>
                      Espelha exatamente o que você está vendo no monitor principal do computador para a Smart TV.
                    </p>
                  </div>
                </button>
              </div>

              {/* Form Settings (Resolution, FPS, Bitrate, Hardware Enc) */}
              <form onSubmit={handleSaveSettings} className="space-y-4 pt-4 border-t border-neutral-200">
                <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-neutral-800">
                  Parâmetros de Transmissão do Moonlight
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-mono text-neutral-500 uppercase font-bold block mb-1">
                      Resolução
                    </label>
                    <select
                      value={`${settings.width}x${settings.height}`}
                      onChange={(e) => {
                        const [w, h] = e.target.value.split('x').map(Number);
                        setSettings((prev) => ({ ...prev, width: w, height: h }));
                      }}
                      className="w-full bg-neutral-100 border border-neutral-300 rounded-lg px-3 py-2 text-xs font-mono font-bold text-neutral-900 focus:border-neutral-900 outline-none"
                    >
                      <option value="1920x1080">1920 × 1080 (Full HD)</option>
                      <option value="2560x1440">2560 × 1440 (2K QHD)</option>
                      <option value="3840x2160">3840 × 2160 (4K UHD)</option>
                      <option value="1280x720">1280 × 720 (HD)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono text-neutral-500 uppercase font-bold block mb-1">
                      Taxa de Quadros (FPS)
                    </label>
                    <select
                      value={settings.fps}
                      onChange={(e) => setSettings((prev) => ({ ...prev, fps: Number(e.target.value) }))}
                      className="w-full bg-neutral-100 border border-neutral-300 rounded-lg px-3 py-2 text-xs font-mono font-bold text-neutral-900 focus:border-neutral-900 outline-none"
                    >
                      <option value={30}>30 FPS</option>
                      <option value={60}>60 FPS (Padrão)</option>
                      <option value={120}>120 FPS (Alta Fluidez)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] font-mono text-neutral-500 uppercase font-bold">
                      Taxa de Bits (Bitrate)
                    </label>
                    <span className="text-xs font-mono font-black text-neutral-900">
                      {settings.bitrateMbps} Mbps
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={settings.bitrateMbps}
                    onChange={(e) => setSettings((prev) => ({ ...prev, bitrateMbps: Number(e.target.value) }))}
                    className="w-full accent-neutral-900 cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] font-mono text-neutral-400">
                    <span>5 Mbps (Leve)</span>
                    <span>20 Mbps (Recomendado)</span>
                    <span>100 Mbps (Ultra)</span>
                  </div>
                </div>

                <div className="flex items-center space-x-3 pt-2">
                  <input
                    id="hardware-checkbox"
                    type="checkbox"
                    checked={settings.hardware}
                    onChange={(e) => setSettings((prev) => ({ ...prev, hardware: e.target.checked }))}
                    className="w-4 h-4 rounded border-neutral-300 accent-neutral-900 cursor-pointer"
                  />
                  <label htmlFor="hardware-checkbox" className="text-xs font-mono font-semibold text-neutral-800 cursor-pointer">
                    Aceleração de Hardware por GPU (Media Foundation NVENC / AMD / Intel)
                  </label>
                </div>

                <div className="flex items-center justify-between pt-3">
                  <span className="text-xs font-mono text-emerald-700 font-bold">
                    {settingsSavedMessage}
                  </span>
                  <button
                    type="submit"
                    disabled={isSavingSettings}
                    className="px-5 py-2.5 bg-neutral-900 text-white hover:bg-neutral-800 rounded-xl text-xs font-bold font-mono uppercase tracking-wider transition shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {isSavingSettings ? 'Aplicando...' : 'Salvar e Aplicar'}
                  </button>
                </div>
              </form>
            </GlassCard>
          </div>

          {/* Displays Catalog & Virtual Driver Info */}
          <div className="lg:col-span-2 flex flex-col gap-5">
            <GlassCard className="p-6 space-y-4">
              <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-wider font-mono border-b border-neutral-200/60 pb-3">
                Monitores Detectados no Windows
              </h3>

              <div className="space-y-3">
                {displays.map((disp) => {
                  const isVirtualScreen = disp.virtual;
                  const isMirroring = displayMode === 'duplicate' && !isVirtualScreen;
                  const isExtending = displayMode === 'extended' && isVirtualScreen;
                  const isActiveStream = isMirroring || isExtending;

                  return (
                    <div
                      key={disp.index}
                      className={`p-3.5 rounded-xl border text-xs font-mono transition-all duration-200
                        ${isActiveStream
                          ? 'bg-neutral-900 text-white border-neutral-900 shadow-md ring-2 ring-emerald-500/20'
                          : 'bg-white border-neutral-200 text-neutral-700'}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold flex items-center space-x-2">
                          {disp.virtual ? (
                            <svg className="w-4 h-4 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <rect x="2" y="4" width="20" height="13" rx="2" strokeWidth="2" />
                              <path d="M8 21h8m-4-4v4" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-neutral-700 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <rect x="3" y="4" width="18" height="12" rx="2" strokeWidth="2" />
                              <path d="M9 20h6m-3-4v4" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          )}
                          <span className="truncate">{disp.name}</span>
                        </span>
                        <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border
                          ${isActiveStream
                            ? 'bg-emerald-500 text-white border-emerald-400'
                            : 'bg-neutral-100 text-neutral-600 border-neutral-250'}`}>
                          {isActiveStream
                            ? (displayMode === 'duplicate' ? 'Transmitindo (Espelho)' : 'Transmitindo (Extensão TV)')
                            : (disp.primary ? 'Livre para Uso Local' : 'Inativo (Modo Espelho)')}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[10px] mt-2.5 opacity-80">
                        <span className="font-semibold">{disp.width} × {disp.height}</span>
                        <span className="font-mono text-[9px] opacity-70">{disp.deviceName}</span>
                      </div>
                    </div>
                  );
                })}

                {displays.length === 0 && (
                  <p className="text-xs text-neutral-500 font-mono">Nenhum monitor enumerado ainda.</p>
                )}
              </div>

              {/* Virtual driver quick actions */}
              <div className="pt-4 border-t border-neutral-200/60 space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-neutral-600">Status do Driver MTT VDD:</span>
                  <span className={`font-bold px-2 py-0.5 rounded text-[10px] uppercase border
                    ${driverStatus.installed ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-rose-100 text-rose-800 border-rose-300'}`}>
                    {driverStatus.installed ? 'Instalado' : 'Não Instalado'}
                  </span>
                </div>
                {!driverStatus.installed && (
                  <button
                    type="button"
                    onClick={handleInstallDriver}
                    disabled={installingDriver}
                    className="w-full mt-2 py-2 px-3 bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg text-xs font-bold font-mono tracking-wider uppercase transition cursor-pointer"
                  >
                    {installingDriver ? 'Instalando...' : 'Instalar Driver Virtual'}
                  </button>
                )}
              </div>
            </GlassCard>
          </div>
        </div>
      )}

      {/* ── Section: PIN Pairing ── */}
      {activeSection === 'pairing' && (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* PIN Form */}
          <div className="lg:col-span-3 flex flex-col gap-5">
            <GlassCard className="p-6 space-y-5">
              <div>
                <span className="text-[10px] uppercase font-mono tracking-wider text-neutral-500">Autenticação</span>
                <h3 className="text-base font-bold text-neutral-900 uppercase tracking-wider font-mono mt-0.5">
                  {pairingTarget ? `Parear com ${pairingTarget}` : 'Vincular Dispositivo Moonlight'}
                </h3>
                <p className="text-xs text-neutral-600 mt-2 leading-relaxed">
                  Abra o aplicativo Moonlight na sua Smart TV, selecione este computador e digite o código PIN de 4 dígitos exibido na tela da TV.
                </p>
              </div>

              {incomingRequest && (
                <div className="flex items-center justify-between p-3.5 bg-cyan-500/10 border border-cyan-300 rounded-xl text-cyan-950 text-xs font-semibold animate-fadeIn shadow-sm">
                  <div className="flex items-center space-x-2.5">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-600"></span>
                    </span>
                    <span>Pedido de conexão recebido da TV! Insira os 4 dígitos exibidos na tela abaixo.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIncomingRequest(null)}
                    className="text-cyan-700 hover:text-cyan-950 p-1 rounded-md hover:bg-cyan-100/50 transition cursor-pointer"
                    title="Fechar"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}

              <form onSubmit={handlePairPin} className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <input
                    id="moonlight-pin-input"
                    type="text"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    disabled={pairingStatus === 'pairing'}
                    placeholder="0000"
                    autoFocus
                    className="w-full bg-neutral-100 border border-neutral-350 focus:border-neutral-900 rounded-xl px-4 py-3 font-mono text-center text-3xl font-black tracking-[0.5em] text-neutral-900 outline-none transition duration-200 placeholder:tracking-normal placeholder:text-neutral-400 disabled:opacity-50 focus:ring-1 focus:ring-neutral-200"
                  />
                  <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none">
                    <span className="text-[9px] font-mono text-neutral-500 uppercase font-bold">PIN</span>
                  </div>
                </div>
                <button
                  type="submit"
                  id="pair-moonlight-btn"
                  disabled={pairingStatus === 'pairing' || pin.length !== 4}
                  className="px-6 py-3 bg-neutral-900 text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 text-sm font-bold font-mono rounded-xl transition duration-150 shadow-sm flex items-center justify-center space-x-2 cursor-pointer disabled:cursor-not-allowed"
                >
                  {pairingStatus === 'pairing' ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      <span>Pareando...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      <span>Parear Dispositivo</span>
                    </>
                  )}
                </button>
              </form>

              {pairingStatus === 'success' && (
                <div className="flex items-start space-x-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-850 text-xs font-semibold animate-fadeIn">
                  <svg className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Pareamento realizado com sucesso! A TV foi autorizada e já está pronta para iniciar a transmissão.</span>
                </div>
              )}
              {pairingStatus === 'error' && (
                <div className="flex items-start space-x-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-850 text-xs font-semibold animate-fadeIn">
                  <svg className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <p className="font-bold">Falha no pareamento: {pairingError}</p>
                    {hostStatus !== 'running' && (
                      <p className="mt-1 text-rose-800 font-normal">O host nativo não está ativo. Inicie-o primeiro no topo.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Paired devices list */}
              <div className="bg-neutral-50 border border-neutral-200/60 rounded-xl p-4 space-y-2 font-mono text-xs">
                <p className="text-[10px] uppercase text-neutral-500 tracking-wider mb-2 font-bold">
                  Clientes Autorizados ({clients.length})
                </p>
                {clients.map((c) => (
                  <div key={c.uuid} className="flex justify-between items-center py-1 border-t border-neutral-200/60">
                    <span className="text-neutral-800 font-bold truncate">{c.name}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveClient(c.uuid)}
                      className="text-rose-600 hover:text-rose-800 text-[11px] font-bold cursor-pointer"
                    >
                      Remover
                    </button>
                  </div>
                ))}
                {clients.length === 0 && (
                  <p className="text-neutral-500 text-[11px]">Nenhum cliente pareado ainda.</p>
                )}
              </div>
            </GlassCard>
          </div>

          {/* Guide Sidebar */}
          <GlassCard className="lg:col-span-2 p-6 space-y-5 flex flex-col justify-between relative overflow-hidden">
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-wider font-mono border-b border-neutral-200/60 pb-3">
                Como Parear em 4 Passos
              </h3>
              <div className="space-y-4 text-xs">
                {[
                  { n: '1', title: 'Iniciar o Host', desc: 'Verifique se o Host Nativo está com status "Ativo" no topo.' },
                  { n: '2', title: 'Abrir Moonlight na TV', desc: 'No app Moonlight da sua TV, selecione este computador.' },
                  { n: '3', title: 'Ver o PIN na TV', desc: 'Aparecerá um código PIN de 4 dígitos na tela da sua TV.' },
                  { n: '4', title: 'Digitar o PIN', desc: 'Insira os 4 dígitos aqui e clique em Parear Dispositivo.' },
                ].map((s) => (
                  <div key={s.n} className="flex items-start space-x-3">
                    <div className="w-5 h-5 rounded-full bg-neutral-900 text-white flex items-center justify-center font-mono font-bold text-xs shrink-0 mt-0.5">{s.n}</div>
                    <div>
                      <h4 className="font-bold text-neutral-900 font-mono text-[11px]">{s.title}</h4>
                      <p className="text-neutral-600 leading-relaxed mt-0.5">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5">
              <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-900">Segunda Tela Automática</p>
              <p className="text-[11px] text-neutral-600 leading-relaxed mt-1">
                Com o modo <strong>Estender Tela</strong> ativado, o Moonlight abre diretamente a tela secundária independente, sem atrapalhar seu trabalho no computador.
              </p>
            </div>
          </GlassCard>
        </div>
      )}

      {/* ── Section: Guias de Instalação na TV ── */}
      {activeSection === 'guides' && (
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto">
          {/* LG webOS */}
          <GlassCard className="p-5 flex flex-col justify-between space-y-4 border-l-4 border-l-rose-500">
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-mono font-bold uppercase">LG webOS</span>
                <span className="text-[10px] text-neutral-500 font-mono">OLED / NanoCell / QNED</span>
              </div>
              <h4 className="font-bold text-sm text-neutral-900 mt-2">LG Smart TV (webOS)</h4>
              <p className="text-xs text-neutral-600 mt-1.5 leading-relaxed">
                Disponível através do <strong>Homebrew Channel webOS</strong> ou diretamente na loja de aplicativos dependendo da versão do webOS.
              </p>
              <ul className="text-xs text-neutral-600 list-disc list-inside mt-3 space-y-1">
                <li>Instale o app <strong>Moonlight</strong> no webOS</li>
                <li>Abra o app e seu PC aparecerá na lista</li>
                <li>Clique para parear com o PIN de 4 dígitos</li>
              </ul>
            </div>
            <div className="pt-3 border-t border-neutral-200 text-[10px] font-mono text-neutral-500">
              Suporte a 4K 60FPS / HDR10
            </div>
          </GlassCard>

          {/* Samsung Tizen */}
          <GlassCard className="p-5 flex flex-col justify-between space-y-4 border-l-4 border-l-blue-500">
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-mono font-bold uppercase">Samsung Tizen</span>
                <span className="text-[10px] text-neutral-500 font-mono">QLED / Crystal UHD</span>
              </div>
              <h4 className="font-bold text-sm text-neutral-900 mt-2">Samsung Smart TV (Tizen)</h4>
              <p className="text-xs text-neutral-600 mt-1.5 leading-relaxed">
                Disponível via Moonlight for Tizen (instalação via Modo Desenvolvedor ou USB no Tizen OS 2016+).
              </p>
              <ul className="text-xs text-neutral-600 list-disc list-inside mt-3 space-y-1">
                <li>Instale o <strong>Moonlight Tizen</strong> na TV</li>
                <li>Conecte na mesma rede Wi-Fi deste PC</li>
                <li>Insira o PIN exibido na tela da TV</li>
              </ul>
            </div>
            <div className="pt-3 border-t border-neutral-200 text-[10px] font-mono text-neutral-500">
              Suporte a 1080p e 4K 60FPS
            </div>
          </GlassCard>

          {/* Android TV & Google TV */}
          <GlassCard className="p-5 flex flex-col justify-between space-y-4 border-l-4 border-l-emerald-500">
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold uppercase">Google Play</span>
                <span className="text-[10px] text-neutral-500 font-mono">Android TV / Google TV</span>
              </div>
              <h4 className="font-bold text-sm text-neutral-900 mt-2">Android TV, Chromecast, Sony & TCL</h4>
              <p className="text-xs text-neutral-600 mt-1.5 leading-relaxed">
                Instalação direta e nativa pela <strong>Google Play Store</strong> da Smart TV ou TV Box (Mi Box, Fire Stick, Realme).
              </p>
              <ul className="text-xs text-neutral-600 list-disc list-inside mt-3 space-y-1">
                <li>Abra a <strong>Google Play Store</strong> na TV</li>
                <li>Pesquise por <strong>Moonlight Game Streaming</strong></li>
                <li>Instale e inicie o app gratuitamente</li>
              </ul>
            </div>
            <div className="pt-3 border-t border-neutral-200 text-[10px] font-mono text-neutral-500">
              Suporte a 120 FPS / AV1 / HEVC
            </div>
          </GlassCard>

          {/* Apple TV */}
          <GlassCard className="p-5 flex flex-col justify-between space-y-4 border-l-4 border-l-neutral-700">
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-800 text-[10px] font-mono font-bold uppercase">App Store</span>
                <span className="text-[10px] text-neutral-500 font-mono">Apple TV 4K / HD</span>
              </div>
              <h4 className="font-bold text-sm text-neutral-900 mt-2">Apple TV (tvOS)</h4>
              <p className="text-xs text-neutral-600 mt-1.5 leading-relaxed">
                Disponível oficialmente na <strong>App Store do tvOS</strong> para Apple TV 4K e HD.
              </p>
              <ul className="text-xs text-neutral-600 list-disc list-inside mt-3 space-y-1">
                <li>Abra a <strong>App Store</strong> na Apple TV</li>
                <li>Pesquise por <strong>Moonlight Game Streaming</strong></li>
                <li>Conecte controles Xbox/PlayStation via Bluetooth</li>
              </ul>
            </div>
            <div className="pt-3 border-t border-neutral-200 text-[10px] font-mono text-neutral-500">
              Suporte a 4K HDR e Áudio Espacial
            </div>
          </GlassCard>

          {/* Amazon Fire TV */}
          <GlassCard className="p-5 flex flex-col justify-between space-y-4 border-l-4 border-l-amber-500">
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-mono font-bold uppercase">Amazon Store</span>
                <span className="text-[10px] text-neutral-500 font-mono">Fire TV Stick 4K / Cube</span>
              </div>
              <h4 className="font-bold text-sm text-neutral-900 mt-2">Amazon Fire TV</h4>
              <p className="text-xs text-neutral-600 mt-1.5 leading-relaxed">
                Disponível na <strong>Amazon Appstore</strong> diretamente no Fire TV Stick.
              </p>
              <ul className="text-xs text-neutral-600 list-disc list-inside mt-3 space-y-1">
                <li>Pesquise por <strong>Moonlight</strong> no Fire TV</li>
                <li>Faça o download gratuito</li>
                <li>Descubra este PC automaticamente</li>
              </ul>
            </div>
            <div className="pt-3 border-t border-neutral-200 text-[10px] font-mono text-neutral-500">
              Compatível com todos Fire TV Sticks
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
};

export default MoonlightPanel;
