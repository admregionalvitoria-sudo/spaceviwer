// SpaceViewer v2.2.9
import React, { useState, useEffect } from 'react';
import { NetworkMonitor } from './NetworkMonitor';
import { useMasterStore } from '../stores/masterStore';
import { GlassCard } from '../components/ui/GlassCard';
import { Toggle } from '../components/ui/Toggle';
import type { AppSettings, VideoCodec, AudioSource, UpdateInfo, UpdateProgress, DisplayQuality, DisplaySettings, QualityPreset, DisplayTransport } from '../../shared/types';
import { APP_VERSION, DEFAULT_SETTINGS, QUALITY_PRESET_LABELS, SUPPORTED_DISPLAY_FPS, PRESET_FPS_OPTIONS, MIN_BITRATE_KBPS, MAX_BITRATE_KBPS, resolveQuality } from '../../shared/constants';

export const Settings: React.FC = () => {
  const { settings, updateSettings, loadSettings } = useMasterStore();
  const [activeTab, setActiveTab] = useState<'displays' | 'server' | 'stream' | 'audio' | 'system' | 'network' | 'update'>('displays');

  // Auto-update states
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<UpdateProgress | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateStatusText, setUpdateStatusText] = useState<string | null>(null);
  const [currentAppVersion, setCurrentAppVersion] = useState<string>(APP_VERSION);
  const [updatePhase, setUpdatePhase] = useState<'idle' | 'downloading' | 'ready_to_restart' | 'applying'>('idle');
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [isApplyingRestart, setIsApplyingRestart] = useState(false);

  // Form states
  const [port, setPort] = useState(settings.server.port);
  const [networkInterface, setNetworkInterface] = useState(settings.server.networkInterface);
  const [enableMdns, setEnableMdns] = useState(settings.server.enableMdns);
  const [password, setPassword] = useState(settings.server.password || '');

  const [defaultCodec, setDefaultCodec] = useState(settings.stream.defaultCodec);
  const [defaultFps, setDefaultFps] = useState(settings.stream.defaultFps);
  const [defaultBitrate, setDefaultBitrate] = useState(settings.stream.defaultBitrate);
  const [hardwareEncoding, setHardwareEncoding] = useState(settings.stream.hardwareEncoding);

  const [playOnAgentOnly, setPlayOnAgentOnly] = useState(settings.audio.playOnAgentOnly);
  const [defaultVolume, setDefaultVolume] = useState(settings.audio.defaultVolume);

  const [launchWithWindows, setLaunchWithWindows] = useState(settings.startup.launchWithWindows);
  const [minimizeToTray, setMinimizeToTray] = useState(settings.startup.minimizeToTray);
  const [language, setLanguage] = useState(settings.ui.language);

  const displayDefaults = settings.display ?? DEFAULT_SETTINGS.display;
  const [displayTransport, setDisplayTransport] = useState<DisplayTransport>(displayDefaults.transport ?? DEFAULT_SETTINGS.display.transport);
  const [totalBitrateKbps, setTotalBitrateKbps] = useState<number>(displayDefaults.totalBitrateKbps ?? DEFAULT_SETTINGS.display.totalBitrateKbps);
  const [displayQuality, setDisplayQuality] = useState<DisplayQuality>(displayDefaults.quality);
  const [displayAudio, setDisplayAudio] = useState(displayDefaults.audio ?? DEFAULT_SETTINGS.display.audio);
  const [keepVirtualDisplays, setKeepVirtualDisplays] = useState(displayDefaults.keepVirtualDisplays);
  const [autoReconnect, setAutoReconnect] = useState(displayDefaults.autoReconnect);

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadSettings();
    if (window.screenflow?.getAppVersion) {
      window.screenflow.getAppVersion().then((v) => {
        if (v) setCurrentAppVersion(v);
      });
    }
    const unsub = window.screenflow?.onUpdateProgress
      ? window.screenflow.onUpdateProgress((p) => {
          setDownloadProgress(p);
        })
      : () => {};
    return () => {
      unsub();
    };
  }, []);

  const handleCheckForUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateError(null);
    setUpdateStatusText('Buscando novas atualizações do SpaceViewer...');
    try {
      if (!window.screenflow?.checkForUpdates) {
        throw new Error('Módulo de atualização não disponível no ambiente');
      }
      const info = await window.screenflow.checkForUpdates();
      setUpdateInfo(info);
      if (info.error) {
        setUpdateError(info.error);
        setUpdateStatusText(null);
      } else if (!info.updateAvailable) {
        setUpdateStatusText('Você já está utilizando a versão mais recente!');
      } else {
        setUpdateStatusText(null);
      }
    } catch (err: any) {
      setUpdateError(err.message || 'Falha ao buscar atualizações no servidor.');
      setUpdateStatusText(null);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleDownloadAndInstall = async () => {
    if (!updateInfo) return;
    if (!updateInfo.downloadUrl) {
      if (updateInfo.htmlUrl) {
        window.open(updateInfo.htmlUrl, '_blank');
      }
      return;
    }
    setIsDownloadingUpdate(true);
    setUpdatePhase('downloading');
    setUpdateError(null);
    try {
      const res = await window.screenflow.downloadAndInstallUpdate(updateInfo.downloadUrl);
      if (res.success) {
        setUpdatePhase('ready_to_restart');
        setShowRestartModal(true);
      } else if (res.error) {
        setUpdateError(res.error);
        setUpdatePhase('idle');
        setIsDownloadingUpdate(false);
      }
    } catch (err: any) {
      setUpdateError(err.message || 'Falha ao baixar a atualização');
      setUpdatePhase('idle');
      setIsDownloadingUpdate(false);
    }
  };

  const handleApplyAndRestart = async () => {
    setIsApplyingRestart(true);
    setUpdatePhase('applying');
    try {
      await window.screenflow.applyUpdateAndRestart();
    } catch (err: any) {
      setUpdateError(err.message || 'Falha ao iniciar reinicialização');
      setIsApplyingRestart(false);
      setUpdatePhase('ready_to_restart');
    }
  };

  // Sync inputs when settings load
  useEffect(() => {
    setPort(settings.server.port);
    setNetworkInterface(settings.server.networkInterface);
    setEnableMdns(settings.server.enableMdns);
    setPassword(settings.server.password || '');
    setDefaultCodec(settings.stream.defaultCodec);
    setDefaultFps(settings.stream.defaultFps);
    setDefaultBitrate(settings.stream.defaultBitrate);
    setHardwareEncoding(settings.stream.hardwareEncoding);
    setPlayOnAgentOnly(settings.audio.playOnAgentOnly);
    setDefaultVolume(settings.audio.defaultVolume);
    setLaunchWithWindows(settings.startup.launchWithWindows);
    setMinimizeToTray(settings.startup.minimizeToTray);
    setLanguage(settings.ui.language);
    const display = settings.display ?? DEFAULT_SETTINGS.display;
    setDisplayTransport(display.transport ?? DEFAULT_SETTINGS.display.transport);
    setTotalBitrateKbps(display.totalBitrateKbps ?? DEFAULT_SETTINGS.display.totalBitrateKbps);
    setDisplayQuality(display.quality);
    setDisplayAudio(display.audio ?? DEFAULT_SETTINGS.display.audio);
    setKeepVirtualDisplays(display.keepVirtualDisplays);
    setAutoReconnect(display.autoReconnect);
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setSaveSuccess(false);
    setSaveError('');
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      setSaveError('Informe uma porta entre 1024 e 65535.');
      return;
    }

    const updated: AppSettings = {
      server: {
        port,
        networkInterface,
        enableMdns,
        enableMiracast: settings.server.enableMiracast,
        password: password || undefined,
        allowedIps: settings.server.allowedIps,
      },
      stream: {
        defaultCodec,
        defaultFps,
        defaultBitrate,
        hardwareEncoding,
      },
      audio: {
        defaultSource: settings.audio.defaultSource,
        playOnAgentOnly,
        syncOffset: settings.audio.syncOffset,
        defaultVolume,
      },
      startup: {
        launchWithWindows,
        minimizeToTray,
        autoStartStream: settings.startup.autoStartStream,
        showNotifications: settings.startup.showNotifications,
      },
      ui: {
        theme: settings.ui.theme,
        language,
        compactMode: settings.ui.compactMode,
      },
      display: {
        transport: displayTransport,
        totalBitrateKbps,
        quality: displayQuality,
        audio: displayAudio,
        keepVirtualDisplays,
        autoReconnect,
      },
    };

    setIsSaving(true);
    try {
      await updateSettings(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.');
    } finally { setIsSaving(false); }
  };

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: 'displays', label: 'Telas sem fio' },
    { id: 'server', label: 'Servidor' },
    { id: 'stream', label: 'Transmissão' },
    { id: 'audio', label: 'Áudio' },
    { id: 'system', label: 'Sistema' },
    { id: 'network', label: 'Rede' },
    { id: 'update', label: 'Atualização' },
  ];

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto h-full select-none bg-bg-space text-neutral-900">
      {/* Header */}
      <div className="border-b border-neutral-200/60 pb-4">
        <h2 className="font-display font-semibold text-xl text-neutral-900 tracking-tight">Opções</h2>
        <p className="text-xs text-neutral-500 mt-1">Ajuste os parâmetros de rede, qualidade de áudio e vídeo do SpaceViewer.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Tab List */}
        <div role="tablist" aria-label="Opções" className="w-full md:w-48 shrink-0 flex md:flex-col space-x-2 md:space-x-0 md:space-y-1.5 overflow-x-auto border-b md:border-b-0 md:border-r border-neutral-200/60 pb-3 md:pb-0 md:pr-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`options-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls="options-panel"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 rounded-xl text-xs font-semibold uppercase tracking-wider text-left transition-all duration-200 ${
                activeTab === tab.id
                  ? 'bg-neutral-900 text-white shadow-sm border border-neutral-900'
                  : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content Box */}
        <div className="flex-1 min-w-0 w-full max-w-4xl" id="options-panel" role="tabpanel" aria-labelledby={`options-tab-${activeTab}`}>
          {activeTab === 'network' ? <NetworkMonitor embedded /> : <form onSubmit={handleSave} className="space-y-5">
            <GlassCard className="p-6">
              {activeTab === 'displays' && (
                <DisplayQualitySection
                  transport={displayTransport}
                  onTransportChange={setDisplayTransport}
                  totalBitrateKbps={totalBitrateKbps}
                  onTotalBitrateKbpsChange={setTotalBitrateKbps}
                  quality={displayQuality}
                  onChange={(patch) => setDisplayQuality((q) => ({ ...q, ...patch }))}
                  audio={displayAudio}
                  onAudioChange={(patch) => setDisplayAudio((a) => ({ ...a, ...patch }))}
                  keepVirtualDisplays={keepVirtualDisplays}
                  onKeepVirtualDisplays={setKeepVirtualDisplays}
                  autoReconnect={autoReconnect}
                  onAutoReconnect={setAutoReconnect}
                />
              )}

              {activeTab === 'server' && (
                <div className="space-y-4">
                  <h3 className="font-display font-bold text-sm text-neutral-900 mb-3 uppercase tracking-wider">Ajustes do Servidor</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block font-mono text-[10px] text-neutral-500 uppercase mb-1.5">Porta WebSocket</label>
                      <input
                        type="number"
                        min={1024}
                        max={65535}
                        required
                        value={port}
                        onChange={(e) => setPort(parseInt(e.target.value, 10))}
                        className="w-full bg-white border border-neutral-300 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-950 rounded-xl px-3 py-2 text-sm text-neutral-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] text-neutral-500 uppercase mb-1.5">Interface de Rede</label>
                      <select
                        value={networkInterface}
                        onChange={(e) => setNetworkInterface(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl text-sm text-neutral-900 outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-950"
                      >
                        <option value="auto">Automático (Todos)</option>
                        <option value="eth0">Ethernet Gigabit</option>
                        <option value="wlan0">Rede Wi-Fi (Sem Fios)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-mono text-[10px] text-neutral-500 uppercase mb-1.5">Senha da Sessão (Opcional)</label>
                    <input
                      type="password"
                      placeholder="Sem senha por padrão"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-white border border-neutral-300 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-950 rounded-xl px-3 py-2 text-sm text-neutral-900 outline-none"
                    />
                  </div>

                  <div className="pt-2">
                    <Toggle
                      label="Ativar Autodescoberta mDNS (Bonjour)"
                      checked={enableMdns}
                      onChange={setEnableMdns}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'stream' && (
                <div className="space-y-4">
                  <p className="text-xs text-neutral-500">Padrões dos receptores SpaceViewer para PC (WebRTC). A qualidade dos tablets e celulares fica em Telas sem fio.</p>
                  <h3 className="font-display font-bold text-sm text-neutral-900 mb-3 uppercase tracking-wider">Padrões de Transmissão</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block font-mono text-[10px] text-neutral-500 uppercase mb-1.5">Codec de Vídeo Padrão</label>
                      <select
                        value={defaultCodec}
                        onChange={(e) => setDefaultCodec(e.target.value as VideoCodec)}
                        className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl text-sm text-neutral-900 outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-950"
                      >
                        <option value="H264">H.264 (Recomendado)</option>
                        <option value="VP8">VP8</option>
                        <option value="VP9">VP9 (Maior compactação)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] text-neutral-500 uppercase mb-1.5">Taxa FPS Padrão</label>
                      <select
                        value={defaultFps}
                        onChange={(e) => setDefaultFps(parseInt(e.target.value, 10))}
                        className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl text-sm text-neutral-900 outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-950"
                      >
                        <option value="30">30 FPS (Fluido)</option>
                        <option value="60">60 FPS (Ultra Fluido)</option>
                        <option value="120">120 FPS (Competitivo)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center text-[10px] font-mono mb-1.5">
                      <span className="text-neutral-500 uppercase">Bitrate Máximo Padrão</span>
                      <span className="text-neutral-900 font-bold">{(defaultBitrate / 1000).toFixed(1)} Mbps</span>
                    </div>
                    <input
                      type="range"
                      min="1000"
                      max="15000"
                      step="500"
                      value={defaultBitrate}
                      onChange={(e) => setDefaultBitrate(parseInt(e.target.value, 10))}
                      className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded-lg cursor-pointer"
                    />
                  </div>

                  <div className="pt-2">
                    <Toggle
                      label="Forçar Aceleração de Hardware"
                      checked={hardwareEncoding}
                      onChange={setHardwareEncoding}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'audio' && (
                <div className="space-y-4">
                  <h3 className="font-display font-bold text-sm text-neutral-900 mb-3 uppercase tracking-wider">Ajustes de Áudio</h3>
                  <Toggle
                    label="Reproduzir Áudio APENAS no Receptor"
                    checked={playOnAgentOnly}
                    onChange={setPlayOnAgentOnly}
                  />
                  <div>
                    <div className="flex justify-between items-center text-[10px] font-mono mb-1.5">
                      <span className="text-neutral-550 uppercase">Volume Inicial do Receptor</span>
                      <span className="text-neutral-900 font-bold">{defaultVolume}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={defaultVolume}
                      onChange={(e) => setDefaultVolume(parseInt(e.target.value, 10))}
                      className="w-full accent-neutral-900 bg-neutral-200 h-1 rounded-lg cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {activeTab === 'system' && (
                <div className="space-y-4">
                  <h3 className="font-display font-bold text-sm text-neutral-900 mb-3 uppercase tracking-wider">Preferências Gerais</h3>
                  <Toggle
                    label="Iniciar junto com o Windows"
                    checked={launchWithWindows}
                    onChange={setLaunchWithWindows}
                  />
                  <Toggle
                    label="Minimizar para a Bandeja de Sistema"
                    checked={minimizeToTray}
                    onChange={setMinimizeToTray}
                  />
                  <div>
                    <label className="block font-mono text-[10px] text-neutral-500 uppercase mb-1.5">Idioma do Sistema</label>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value as any)}
                      className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl text-sm text-neutral-900 outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-950"
                    >
                      <option value="pt-BR">Português (PT-BR)</option>
                      <option value="en">English (EN)</option>
                      <option value="es">Español (ES)</option>
                    </select>
                  </div>
                </div>
              )}

              {activeTab === 'update' && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between pb-3 border-b border-neutral-200/60">
                    <div>
                      <h3 className="font-display font-bold text-sm text-neutral-900 uppercase tracking-wider">
                        Atualização do SpaceViewer
                      </h3>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        Verifique e instale novas versões com facilidade sem reinstalar manualmente.
                      </p>
                    </div>
                    <span className="px-3 py-1 bg-neutral-100 text-neutral-900 border border-neutral-300/80 rounded-full font-mono text-xs font-bold">
                      v{currentAppVersion}
                    </span>
                  </div>

                  <div className="bg-neutral-50/80 border border-neutral-200/80 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-8 h-8 rounded-xl bg-neutral-900 text-white flex items-center justify-center">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </div>
                        <div>
                          <div className="text-xs font-bold text-neutral-900 uppercase tracking-wide">Servidor de Atualizações</div>
                          <div className="text-[11px] font-mono text-neutral-500">Canal Oficial · Conexão Segura</div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleCheckForUpdates}
                        disabled={isCheckingUpdate || isDownloadingUpdate || updatePhase === 'applying'}
                        className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition shadow-sm flex items-center space-x-2 cursor-pointer"
                      >
                        {isCheckingUpdate ? (
                          <>
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                            </svg>
                            <span>Verificando...</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            <span>Verificar Agora</span>
                          </>
                        )}
                      </button>
                    </div>

                    {updateStatusText && !updateError && (
                      <div className="bg-emerald-50 border border-emerald-200/80 rounded-xl p-3 flex items-center space-x-2.5 text-emerald-900 text-xs">
                        <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                        </svg>
                        <span>{updateStatusText}</span>
                      </div>
                    )}

                    {updateError && (
                      <div className="bg-rose-50 border border-rose-200/80 rounded-xl p-3 flex items-start space-x-2.5 text-rose-900 text-xs">
                        <svg className="w-4 h-4 text-rose-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div className="flex-1">
                          <div className="font-bold">Aviso de Verificação</div>
                          <div>{updateError}</div>
                        </div>
                      </div>
                    )}
                  </div>

                  {updateInfo && updateInfo.updateAvailable && (
                    <div className="bg-neutral-900 text-white rounded-2xl p-5 space-y-4 shadow-lg border border-neutral-800">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full font-mono text-[10px] font-bold uppercase tracking-wider">
                            Nova Versão Disponível
                          </span>
                          <h4 className="text-base font-bold mt-1">SpaceViewer v{updateInfo.latestVersion}</h4>
                          <p className="text-xs text-neutral-400">
                            Lançado em {new Date(updateInfo.releaseDate).toLocaleDateString('pt-BR')}
                            {updateInfo.assetSize ? ` • ${(updateInfo.assetSize / (1024 * 1024)).toFixed(1)} MB` : ''}
                          </p>
                        </div>

                        {updatePhase === 'idle' && (
                          <button
                            type="button"
                            onClick={handleDownloadAndInstall}
                            className="px-5 py-2.5 bg-white text-neutral-950 hover:bg-neutral-100 rounded-xl font-bold text-xs uppercase tracking-wider shadow transition cursor-pointer flex items-center space-x-2"
                          >
                            <svg className="w-4 h-4 text-neutral-950" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            <span>Atualizar Agora</span>
                          </button>
                        )}
                      </div>

                      {updateInfo.releaseNotes && updatePhase === 'idle' && (
                        <div className="bg-neutral-950/60 rounded-xl p-3.5 border border-neutral-800/80 text-xs text-neutral-300 max-h-36 overflow-y-auto whitespace-pre-wrap font-sans">
                          {updateInfo.releaseNotes}
                        </div>
                      )}

                      {updatePhase === 'downloading' && (
                        <div className="space-y-2 pt-2 border-t border-neutral-800">
                          <div className="flex justify-between text-xs font-mono">
                            <span className="text-neutral-400 flex items-center space-x-1.5">
                              <svg className="w-3.5 h-3.5 animate-spin text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                              </svg>
                              <span>Baixando atualização...</span>
                            </span>
                            <span className="font-bold text-white">
                              {downloadProgress ? `${downloadProgress.percent}%` : 'Iniciando...'}
                            </span>
                          </div>

                          <div className="w-full bg-neutral-800 h-2.5 rounded-full overflow-hidden">
                            <div
                              className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                              style={{ width: `${downloadProgress ? downloadProgress.percent : 5}%` }}
                            />
                          </div>

                          <div className="text-[11px] text-neutral-400 flex justify-between font-mono">
                            <span>
                              {downloadProgress && downloadProgress.total > 0
                                ? `${(downloadProgress.transferred / (1024 * 1024)).toFixed(1)} MB / ${(downloadProgress.total / (1024 * 1024)).toFixed(1)} MB`
                                : 'Preparando download...'}
                            </span>
                            <span>
                              {downloadProgress && downloadProgress.speed > 0
                                ? `${(downloadProgress.speed / (1024 * 1024)).toFixed(1)} MB/s`
                                : ''}
                            </span>
                          </div>
                        </div>
                      )}

                      {(updatePhase === 'ready_to_restart' || (isDownloadingUpdate && downloadProgress && downloadProgress.percent >= 100)) && (
                        <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-xl p-4 space-y-3">
                          <div className="flex items-center space-x-2.5 text-emerald-300">
                            <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                            <span className="font-bold text-xs uppercase tracking-wide">Download Concluído com Sucesso</span>
                          </div>
                          <p className="text-xs text-neutral-300">
                            A nova versão v{updateInfo.latestVersion} foi baixada e verificada. Reinicie o SpaceViewer agora para concluir a instalação.
                          </p>
                          <div className="flex items-center space-x-3 pt-1">
                            <button
                              type="button"
                              onClick={handleApplyAndRestart}
                              disabled={isApplyingRestart}
                              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs uppercase tracking-wider rounded-xl transition shadow cursor-pointer flex items-center space-x-2"
                            >
                              {isApplyingRestart ? (
                                <>
                                  <div className="w-3.5 h-3.5 border-2 border-neutral-950 border-t-transparent rounded-full animate-spin" />
                                  <span>Iniciando Instalação...</span>
                                </>
                              ) : (
                                <>
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                  <span>Reiniciar e Instalar Agora</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowRestartModal(true)}
                              className="text-xs text-neutral-400 hover:text-white underline cursor-pointer"
                            >
                              Ver Detalhes
                            </button>
                          </div>
                        </div>
                      )}

                      {updatePhase === 'applying' && (
                        <div className="p-4 bg-neutral-950/80 border border-neutral-800 rounded-xl flex items-center space-x-3">
                          <div className="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin shrink-0" />
                          <div>
                            <div className="text-xs font-bold text-white">Instalando Nova Versão...</div>
                            <div className="text-[11px] text-neutral-400">O SpaceViewer reiniciará automaticamente em alguns instantes.</div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="text-[11px] text-neutral-500 space-y-1 bg-neutral-100/50 p-3 rounded-xl border border-neutral-200/60">
                    <div className="font-bold text-neutral-700 uppercase tracking-wider text-[10px]">Informações sobre Atualizações:</div>
                    <div>• O instalador aplica a nova versão sobre a versão atual preservando suas configurações e atalhos.</div>
                    <div>• Não é necessário desinstalar o programa para atualizar para versões mais recentes.</div>
                  </div>
                </div>
              )}

              {/* Modal de confirmação para reiniciar o app */}
              {showRestartModal && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-neutral-200 text-neutral-900 space-y-4 animate-in fade-in zoom-in-95 duration-200">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-sm">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div className="text-center space-y-1.5">
                      <h3 className="font-display font-extrabold text-base uppercase tracking-wider text-neutral-900">
                        Atualização Pronta para Instalar
                      </h3>
                      <p className="text-xs text-neutral-600">
                        A nova versão do SpaceViewer (v{updateInfo?.latestVersion}) foi baixada com sucesso.
                      </p>
                      <p className="text-xs text-neutral-500 pt-1">
                        O aplicativo será reiniciado para concluir a instalação no sistema. Confirme a permissão de administrador no Windows caso seja solicitada.
                      </p>
                    </div>
                    <div className="flex flex-col space-y-2 pt-2">
                      <button
                        type="button"
                        onClick={handleApplyAndRestart}
                        disabled={isApplyingRestart}
                        className="w-full py-3 bg-neutral-900 hover:bg-neutral-850 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-md flex items-center justify-center space-x-2 cursor-pointer"
                      >
                        {isApplyingRestart ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Iniciando Instalação...</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            <span>Reiniciar e Concluir Instalação</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowRestartModal(false)}
                        disabled={isApplyingRestart}
                        className="w-full py-2 text-xs text-neutral-500 hover:text-neutral-800 font-semibold uppercase tracking-wider transition cursor-pointer"
                      >
                        Lembrar Mais Tarde
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </GlassCard>

            {/* Action Bar */}
            {activeTab !== 'update' && (
              <div className="flex items-center justify-between">
                {saveSuccess ? (
                  <span className="font-mono text-xs text-neutral-800 font-bold flex items-center space-x-1.5">
                    <svg className="w-4 h-4 text-neutral-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Configurações salvas com sucesso!</span>
                  </span>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  disabled={isSaving}
                  className="btn-primary-white px-6 py-2.5 rounded-xl text-sm font-bold font-mono tracking-wide active:scale-[0.98] transition duration-150 cursor-pointer shadow-md"
                >
                  {isSaving ? 'Salvando…' : 'Salvar configurações'}
                </button>
              </div>
            )}
            {saveError && <p role="alert" className="text-sm text-rose-700">{saveError}</p>}
          </form>}
        </div>
      </div>
    </div>
  );
};

const fieldLabel = 'block font-mono text-[10px] text-neutral-500 uppercase mb-1.5';
const fieldInput = 'w-full bg-white border border-neutral-300 focus:border-neutral-900 rounded-xl px-3 py-2 text-sm text-neutral-900 outline-none';

/** Global resolution / FPS / bitrate for Android receivers (per-device overrides live in Telas). */
const DisplayQualitySection: React.FC<{
  transport: DisplayTransport;
  onTransportChange: (transport: DisplayTransport) => void;
  totalBitrateKbps: number;
  onTotalBitrateKbpsChange: (total: number) => void;
  quality: DisplayQuality;
  onChange: (patch: Partial<DisplayQuality>) => void;
  audio: DisplaySettings['audio'];
  onAudioChange: (patch: Partial<DisplaySettings['audio']>) => void;
  keepVirtualDisplays: boolean;
  onKeepVirtualDisplays: (value: boolean) => void;
  autoReconnect: boolean;
  onAutoReconnect: (value: boolean) => void;
}> = ({ transport, onTransportChange, totalBitrateKbps, onTotalBitrateKbpsChange, quality, onChange, audio, onAudioChange, keepVirtualDisplays, onKeepVirtualDisplays, autoReconnect, onAutoReconnect }) => {
  const custom = quality.preset === 'custom';
  const choosePreset = (preset: QualityPreset) => {
    if (preset === 'custom' || preset === 'native') onChange({ preset });
    else {
      // The preset sets size and bitrate; the chosen frame rate (30 or 60) is kept.
      const resolved = resolveQuality({ ...quality, preset });
      onChange({ preset, width: resolved.width, height: resolved.height, fps: resolved.fps, bitrateKbps: resolved.bitrateKbps });
    }
  };
  const chooseFps = (fps: number) => {
    if (quality.preset === 'custom') onChange({ fps });
    else {
      const resolved = resolveQuality({ ...quality, fps });
      onChange({ fps: resolved.fps, bitrateKbps: resolved.bitrateKbps });
    }
  };
  const resolvedSummary = resolveQuality(quality);
  const summary = quality.preset === 'native'
    ? `Resolução do próprio aparelho a ${quality.fps === 30 ? 30 : 60} fps (limitado à tela dele); bitrate calculado automaticamente.`
    : `${resolvedSummary.width}×${resolvedSummary.height} · ${resolvedSummary.fps} fps · ${(resolvedSummary.bitrateKbps / 1000).toFixed(0)} Mbps`;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-display font-bold text-sm text-neutral-900 uppercase tracking-wider">Qualidade das telas sem fio</h3>
        <p className="text-xs text-neutral-500 mt-1">
          Vale para todos os tablets e celulares com o SpaceViewer Display. Em Telas você pode escolher outra qualidade para um aparelho específico.
          Em modo Estender a tela estendida é criada nesta resolução.
        </p>
      </div>

      <div>
        <label className={fieldLabel} htmlFor="dq-transport">Modo de transmissão</label>
        <select
          id="dq-transport"
          className={fieldInput}
          value={transport}
          onChange={(e) => onTransportChange(e.target.value as DisplayTransport)}
        >
          <option value="webrtc">WebRTC (padrão — qualidade e fluidez)</option>
          <option value="native">Tempo real (nativo GPU)</option>
        </select>
        <p className="text-[11px] text-neutral-500 mt-1">
          {transport === 'webrtc'
            ? 'Mantém a qualidade de vídeo e fluidez com adaptação automática de rede e reconexão contra travamentos.'
            : 'Captura e codificação na GPU do computador (TCP 47813). Usa WebRTC automaticamente como reserva se o aparelho não suportar.'}
        </p>
      </div>

      <div>
        <label className={fieldLabel} htmlFor="dq-total-bitrate">Banda total para todas as TVs</label>
        <select
          id="dq-total-bitrate"
          className={fieldInput}
          value={totalBitrateKbps}
          onChange={(e) => onTotalBitrateKbpsChange(Number(e.target.value))}
        >
          <option value={10000}>10 Mbps</option>
          <option value={15000}>15 Mbps</option>
          <option value={20000}>20 Mbps (padrão)</option>
          <option value={30000}>30 Mbps</option>
          <option value={50000}>50 Mbps</option>
        </select>
        <p className="text-[11px] text-neutral-500 mt-1">
          Dividida entre as TVs conectadas. Em Wi-Fi fraco use 10–15 Mbps.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2" role="radiogroup" aria-label="Predefinição de qualidade">
        {(['economy', 'balanced', 'high', 'ultra', 'native', 'custom'] as QualityPreset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            role="radio"
            aria-checked={quality.preset === preset}
            onClick={() => choosePreset(preset)}
            className={`rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition ${quality.preset === preset ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50'}`}
          >
            {QUALITY_PRESET_LABELS[preset]}
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-600">{summary}</p>

      {custom && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className={fieldLabel} htmlFor="dq-width">Largura</label>
            <input id="dq-width" type="number" min={640} max={3840} step={2} className={fieldInput} value={quality.width}
              onChange={(e) => onChange({ width: Number(e.target.value) })} />
          </div>
          <div>
            <label className={fieldLabel} htmlFor="dq-height">Altura</label>
            <input id="dq-height" type="number" min={360} max={2560} step={2} className={fieldInput} value={quality.height}
              onChange={(e) => onChange({ height: Number(e.target.value) })} />
          </div>
          <div>
            <label className={fieldLabel} htmlFor="dq-fps">FPS</label>
            <select id="dq-fps" className={fieldInput} value={quality.fps} onChange={(e) => onChange({ fps: Number(e.target.value) })}>
              {SUPPORTED_DISPLAY_FPS.map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
            </select>
          </div>
          <div>
            <label className={fieldLabel} htmlFor="dq-bitrate">Bitrate: {(quality.bitrateKbps / 1000).toFixed(0)} Mbps</label>
            <input id="dq-bitrate" type="range" min={MIN_BITRATE_KBPS} max={MAX_BITRATE_KBPS} step={1000} className="w-full accent-neutral-900"
              value={quality.bitrateKbps} onChange={(e) => onChange({ bitrateKbps: Number(e.target.value) })} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className={fieldLabel} htmlFor="dq-priority">Prioridade</label>
          <select id="dq-priority" className={fieldInput} value={quality.priority} onChange={(e) => onChange({ priority: e.target.value as DisplayQuality['priority'] })}>
            <option value="smoothness">Fluidez — menor atraso do mouse (recomendado)</option>
            <option value="balanced">Equilibrada</option>
            <option value="sharpness">Nitidez — textos (pode reduzir o fps)</option>
          </select>
        </div>
        <div>
          <label className={fieldLabel} htmlFor="dq-codec">Codec</label>
          <select id="dq-codec" className={fieldInput} value={quality.codec} onChange={(e) => onChange({ codec: e.target.value as DisplayQuality['codec'] })}>
            <option value="H264">H.264 (recomendado, decodificação por hardware)</option>
            <option value="VP9">VP9 (melhor imagem, exige mais do aparelho)</option>
            <option value="VP8">VP8 (compatibilidade)</option>
          </select>
        </div>
        <div>
          <label className={fieldLabel} htmlFor="dq-orientation">Orientação no aparelho</label>
          <select id="dq-orientation" className={fieldInput} value={quality.orientation} onChange={(e) => onChange({ orientation: e.target.value as DisplayQuality['orientation'] })}>
            <option value="landscape">Paisagem</option>
            <option value="portrait">Retrato</option>
            <option value="auto">Automática (sensor)</option>
          </select>
        </div>
      </div>

      {!custom && (
        <div>
          <label className={fieldLabel} htmlFor="dq-fps-preset">Quadros por segundo</label>
          <div className="flex gap-2" id="dq-fps-preset" role="radiogroup" aria-label="Quadros por segundo">
            {PRESET_FPS_OPTIONS.map((fps) => (
              <button key={fps} type="button" role="radio" aria-checked={(quality.fps === 30 ? 30 : 60) === fps} onClick={() => chooseFps(fps)}
                className={`rounded-lg border px-4 py-1.5 text-xs font-semibold ${(quality.fps === 30 ? 30 : 60) === fps ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white text-neutral-700'}`}>
                {fps} fps
              </button>
            ))}
          </div>
          <p className="text-[11px] text-neutral-500 mt-1">60 fps deixa o mouse e os vídeos mais fluidos. 30 fps usa cerca de 1/3 menos banda e alivia Wi-Fi fraco ou TVs mais simples.</p>
        </div>
      )}

      <div className="space-y-3 border-t border-neutral-200 pt-4">
        <div>
          <h4 className="font-display font-bold text-xs text-neutral-900 uppercase tracking-wider">Áudio</h4>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Transmite o som do sistema do computador em estéreo (Opus) para os aparelhos conectados.
          </p>
        </div>
        <Toggle
          checked={audio.enabled}
          onChange={(enabled) => onAudioChange({ enabled })}
          label="Transmitir o som do PC para os aparelhos"
        />
        {audio.enabled && (
          <div className="max-w-xs">
            <label className={fieldLabel} htmlFor="dq-audio-bitrate">Qualidade do som</label>
            <select
              id="dq-audio-bitrate"
              className={fieldInput}
              value={audio.bitrateKbps}
              onChange={(e) => onAudioChange({ bitrateKbps: Number(e.target.value) as 96 | 128 | 192 | 256 })}
            >
              <option value={96}>96 kbps (economia)</option>
              <option value={128}>128 kbps (padrão)</option>
              <option value={192}>192 kbps (alta qualidade)</option>
              <option value={256}>256 kbps (máxima fidelidade)</option>
            </select>
          </div>
        )}
      </div>

      <div className="space-y-1 border-t border-neutral-200 pt-4">
        <Toggle checked={autoReconnect} onChange={onAutoReconnect} label="Reconectar automaticamente aparelhos já configurados quando aparecerem na rede" />
        <Toggle checked={keepVirtualDisplays} onChange={onKeepVirtualDisplays} label="Manter o monitor estendido ao desconectar" />
      </div>

      <div className="border-t border-neutral-200 pt-4">
        <button
          type="button"
          className="btn-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer border border-neutral-300 hover:bg-neutral-50 text-neutral-800 transition"
          onClick={() => window.screenflow?.openDiagnosticsFolder?.()}
        >
          Abrir pasta de diagnóstico
        </button>
      </div>
    </div>
  );
};

export default Settings;
