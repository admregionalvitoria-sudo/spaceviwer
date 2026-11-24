// SpaceViewer v3.0.0 — "Telas": PC monitors + Android receivers (extend / mirror)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { QRCodeDisplay } from '../components/ui/QRCodeDisplay';
import { PRESET_FPS_OPTIONS, QUALITY_PRESET_LABELS } from '../../shared/constants';
import type {
  AppWindowSource,
  DisplayReceiver,
  PcDisplay,
  QualityPreset,
  ReceiverMode,
  VirtualDriverState,
} from '../../shared/types';
import { useMasterStore } from '../stores/masterStore';

type HostInfo = { hostname: string; rawHostname: string; ip: string; apkUrl: string | null };
type Notice = { kind: 'ok' | 'error' | 'info'; text: string } | null;

const RESOLUTIONS: Array<[number, number]> = [
  [1280, 720], [1366, 768], [1600, 900], [1920, 1080], [1920, 1200], [2160, 1080], [2400, 1080],
  [2560, 1440], [2560, 1600], [2880, 1800], [3840, 2160], [1080, 1920], [1200, 1920], [1600, 2560],
];
const REFRESH_RATES = [30, 60, 90, 120, 144];

const btn = 'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed';
const btnPrimary = `${btn} bg-neutral-900 text-white hover:bg-neutral-700`;
const btnSecondary = `${btn} bg-white text-neutral-800 border border-neutral-300 hover:bg-neutral-100`;
const btnDanger = `${btn} bg-rose-600 text-white hover:bg-rose-700`;
const selectCls = 'rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-800';

function statusOf(r: DisplayReceiver, host: HostInfo | null): { label: string; tone: string } {
  if (r.session) {
    switch (r.session.status) {
      case 'preparing': return { label: 'Preparando tela…', tone: 'bg-amber-100 text-amber-800' };
      case 'connecting': return { label: r.session.error ? 'Reconectando…' : 'Conectando…', tone: 'bg-amber-100 text-amber-800' };
      case 'streaming': return { label: 'Transmitindo', tone: 'bg-emerald-100 text-emerald-800' };
      case 'error': return { label: 'Erro', tone: 'bg-rose-100 text-rose-800' };
    }
  }
  if (!r.online) return { label: 'Offline', tone: 'bg-neutral-200 text-neutral-600' };
  if (r.connectedTo && host && r.connectedTo !== host.rawHostname) return { label: `Em uso por ${r.connectedTo}`, tone: 'bg-sky-100 text-sky-800' };
  return { label: 'Disponível', tone: 'bg-neutral-100 text-neutral-700' };
}

export const ScreensPanel: React.FC = () => {
  const globalQuality = useMasterStore((s) => s.settings.display?.quality);
  const [displays, setDisplays] = useState<PcDisplay[]>([]);
  const [driver, setDriver] = useState<VirtualDriverState | null>(null);
  const [receivers, setReceivers] = useState<DisplayReceiver[]>([]);
  const [host, setHost] = useState<HostInfo | null>(null);
  const [selectedDisplayId, setSelectedDisplayId] = useState<string>('');
  const [selectedReceivers, setSelectedReceivers] = useState<Set<string>>(new Set());
  const [bulkSource, setBulkSource] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string>('');
  const [notice, setNotice] = useState<Notice>(null);
  const [manualIp, setManualIp] = useState('');

  const [showApk, setShowApk] = useState(false);
  const [appPickerFor, setAppPickerFor] = useState<PcDisplay | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);


  const notify = useCallback((kind: 'ok' | 'error' | 'info', text: string) => {
    setNotice({ kind, text });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), kind === 'error' ? 9000 : 4000);
  }, []);

  const loadDisplays = useCallback(async () => {
    try {
      const [list, state] = await Promise.all([window.screenflow.listPcDisplays(), window.screenflow.getVirtualDriverState().catch(() => null)]);
      setDisplays(list);
      if (state) {
        setDriver(state);
      }
      setSelectedDisplayId((current) => (list.some((d) => d.id === current) ? current : list[0]?.id ?? ''));
    } catch (error) {
      console.error('[Telas] listPcDisplays failed', error);
    }
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      setReceivers(await window.screenflow.scanReceivers());
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    loadDisplays();
    window.screenflow.getHostInfo().then(setHost).catch(() => {});
    window.screenflow.listReceivers().then(setReceivers).catch(() => {});
    scan();
    const offScreens = window.screenflow.onScreensChanged(() => loadDisplays());
    const offReceivers = window.screenflow.onReceiversUpdated((list) => {
      setReceivers(list);
      loadDisplays();
    });
    const offError = window.screenflow.onConnectionError((message) => notify('error', message));
    const timer = setInterval(() => { if (document.visibilityState === 'visible') loadDisplays(); }, 8000);
    return () => { offScreens(); offReceivers(); offError(); clearInterval(timer); clearTimeout(noticeTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Runs a display action with a busy flag and a result notice. */
  const run = useCallback(async (key: string, work: () => Promise<{ success: boolean; error?: string }>, okText?: string) => {
    setBusy(key);
    try {
      const result = await work();
      if (result.success) { if (okText) notify('ok', okText); }
      else notify('error', result.error || 'A operação falhou.');
    } catch (error) {
      notify('error', (error as Error).message);
    } finally {
      setBusy('');
      loadDisplays();
    }
  }, [loadDisplays, notify]);

  const selectedDisplay = displays.find((d) => d.id === selectedDisplayId) ?? null;
  // Older driver installs expose no virtual outputs: they need the one-time reinstall too.
  const driverMissing = Boolean(driver && !driver.remoteSession && (!driver.installed || !driver.enabled || !driver.outputs));
  const primary = displays.find((d) => d.primary) ?? null;
  const receiverName = useCallback((id: string) => receivers.find((r) => r.id === id)?.name ?? 'aparelho', [receivers]);

  const onlineReceivers = receivers.filter((r) => r.online || r.session);
  const allSelected = onlineReceivers.length > 0 && onlineReceivers.every((r) => selectedReceivers.has(r.id));
  const selectedIds = onlineReceivers.filter((r) => selectedReceivers.has(r.id)).map((r) => r.id);
  const activeCount = receivers.filter((r) => r.session).length;

  const bulk = (ids: string[], mode: ReceiverMode, text: string) =>
    run(`bulk-${mode}`, () => window.screenflow.applyReceiversMode(ids, mode, mode === 'mirror' ? bulkSource || primary?.id || '' : undefined), text);

  const addManual = async () => {
    if (!manualIp.trim()) return;
    setBusy('manual');
    const result = await window.screenflow.addReceiverByIp(manualIp.trim());
    setBusy('');
    if (result.success) {
      notify('ok', 'Aparelho adicionado.');
      setManualIp('');
      setReceivers(await window.screenflow.listReceivers());
    } else notify('error', result.error || 'Não foi possível adicionar.');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-5 space-y-5">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Telas</h1>
            <p className="text-xs text-neutral-500 mt-0.5">
              Use tablets e celulares com o app <strong>SpaceViewer Display</strong> como monitores extras: estenda a área de trabalho ou espelhe uma tela.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className={btnSecondary} disabled={!!busy} onClick={() => { loadDisplays(); scan(); }} title="Atualizar">
              ↻
            </button>
          </div>
        </header>

        {notice && (
          <div role="status" className={clsx('rounded-xl px-4 py-2.5 text-xs font-medium whitespace-pre-line border',
            notice.kind === 'error' ? 'bg-rose-50 text-rose-800 border-rose-200' : notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-neutral-50 text-neutral-700 border-neutral-200')}>
            {notice.text}
          </div>
        )}

        {/* PC displays */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-neutral-900">Telas do computador <span className="text-neutral-400 font-medium">({displays.length})</span></h2>
            <span className="text-[11px] text-neutral-500">Clique em uma tela para configurá-la</span>
          </div>

          <ScreenMap displays={displays} selectedId={selectedDisplayId} onSelect={setSelectedDisplayId} receiverName={receiverName} />

          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            {selectedDisplay ? (
              <DisplayDetails
                key={selectedDisplay.id}
                display={selectedDisplay}
                primary={primary}
                busy={!!busy}
                receiverName={receiverName}
                onResolution={(w, h, hz) => run('mode', () => window.screenflow.setDisplayResolution(selectedDisplay.deviceName, w, h, hz), `Resolução aplicada: ${w}×${h} @ ${hz} Hz.`)}
                onPrimary={() => run('primary', () => window.screenflow.setPrimaryDisplay(selectedDisplay.deviceName), 'Tela principal alterada.')}
                onPosition={(x, y) => run('position', () => window.screenflow.setDisplayPosition(selectedDisplay.deviceName, x, y), 'Posição alterada.')}
                onOpenApp={() => setAppPickerFor(selectedDisplay)}
              />
            ) : <div className="text-xs text-neutral-500">Nenhuma tela detectada.</div>}

            {/* Extended display driver */}
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 space-y-3">
              <div>
                <h3 className="text-xs font-bold text-neutral-900">Tela estendida</h3>
                <p className="text-[11px] text-neutral-500 mt-0.5">
                  {driver?.remoteSession
                    ? 'Você está usando o PC pela Área de Trabalho Remota. Nessa sessão o Windows não mostra telas estendidas; use o PC diretamente para Estender. Duplicar funciona normalmente.'
                    : driverMissing
                    ?'Para estender a área de trabalho para os aparelhos, o SpaceViewer precisa de um driver de vídeo (instalado uma única vez).'
                    : driver
                    ? 'Pronto. Cada aparelho em Estender aparece como um monitor do Windows enquanto estiver conectado.'
                    : 'Verificando o driver de tela estendida…'}
                </p>
              </div>
              {driverMissing && (
                <button
                  className={clsx(btnPrimary, 'w-full')}
                  disabled={!!busy}
                  onClick={() => run('driver', () => window.screenflow.installVirtualDriver(), 'Driver de tela estendida instalado.')}
                >
                  {busy === 'driver' ? 'Instalando…' : 'Instalar driver de tela estendida'}
                </button>
              )}
              <button
                className={clsx(btnSecondary, 'w-full')}
                disabled={!!busy}
                onClick={() => run('cursor', () => window.screenflow.ensureVirtualCursor(), 'Cursor ajustado para telas estendidas.')}
              >
                Cursor invisível na TV? Ativar cursor por software
              </button>
              <button
                className={clsx(btnSecondary, 'w-full text-xs py-1')}
                disabled={!!busy}
                onClick={() => run('cursor-normal', () => window.screenflow.restoreNormalCursor(), 'Cursor normal restaurado.')}
              >
                Restaurar cursor normal
              </button>
            </div>
          </div>
        </section>

        {/* Receivers */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-neutral-900">Aparelhos na rede <span className="text-neutral-400 font-medium">({onlineReceivers.length})</span></h2>
              <p className="text-[11px] text-neutral-500">Aparelhos com o app SpaceViewer Display aberto na mesma rede Wi-Fi.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className={btnPrimary} onClick={scan} disabled={scanning}>
                {scanning ? 'Buscando…' : 'Buscar'}
              </button>
              <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); addManual(); }}>
                <input value={manualIp} onChange={(e) => setManualIp(e.target.value)} placeholder="IP do aparelho"
                  aria-label="IP do aparelho" className="w-32 rounded-lg border border-neutral-300 px-2 py-1.5 text-xs" />
                <button type="submit" className={btnSecondary} disabled={busy === 'manual' || !manualIp.trim()}>Adicionar</button>
              </form>
              <button className={btnSecondary} onClick={() => setShowApk(true)}>Instalar o app no aparelho</button>
            </div>
          </div>

          {/* Bulk actions */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-neutral-50 border border-neutral-200 px-3 py-2">
            <label className="flex items-center gap-1.5 text-xs text-neutral-700 mr-1">
              <input type="checkbox" checked={allSelected} disabled={!onlineReceivers.length}
                onChange={(e) => setSelectedReceivers(e.target.checked ? new Set(onlineReceivers.map((r) => r.id)) : new Set())} />
              Selecionar todos
            </label>
            <span className="h-4 w-px bg-neutral-300" />
            <button className={btnPrimary} disabled={!!busy || !onlineReceivers.length} onClick={() => bulk(onlineReceivers.map((r) => r.id), 'extend', 'Estendendo para todos os aparelhos.')}>Estender todas</button>
            <button className={btnSecondary} disabled={!!busy || !onlineReceivers.length} onClick={() => bulk(onlineReceivers.map((r) => r.id), 'mirror', 'Duplicando para todos os aparelhos.')}>Duplicar todas</button>
            <span className="h-4 w-px bg-neutral-300" />
            <button className={btnSecondary} disabled={!!busy || !selectedIds.length} onClick={() => bulk(selectedIds, 'extend', 'Estendendo para os aparelhos selecionados.')}>
              Estender selecionadas ({selectedIds.length})
            </button>
            <button className={btnSecondary} disabled={!!busy || !selectedIds.length} onClick={() => bulk(selectedIds, 'mirror', 'Duplicando para os aparelhos selecionados.')}>
              Duplicar selecionadas ({selectedIds.length})
            </button>
            <label className="flex items-center gap-1 text-[11px] text-neutral-600">
              origem
              <select className={selectCls} value={bulkSource || primary?.id || ''} onChange={(e) => setBulkSource(e.target.value)} aria-label="Tela de origem para duplicar">
                {displays.map((d) => <option key={d.id} value={d.id}>{d.label} ({d.width}×{d.height})</option>)}
              </select>
            </label>
            <span className="flex-1" />
            <button className={btnDanger} disabled={!!busy || !activeCount} onClick={() => run('disconnect-all', () => window.screenflow.disconnectAllReceivers(), 'Todos os aparelhos foram desconectados.')}>
              Desconectar todas
            </button>
          </div>

          {onlineReceivers.length === 0 ? (
            <EmptyReceivers scanning={scanning} host={host} onShowApk={() => setShowApk(true)} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {onlineReceivers.map((r) => (
                <ReceiverCard
                  key={r.id}
                  receiver={r}
                  host={host}
                  displays={displays}
                  selected={selectedReceivers.has(r.id)}
                  globalPresetLabel={globalQuality ? QUALITY_PRESET_LABELS[globalQuality.preset] : ''}
                  onSelect={(checked) => setSelectedReceivers((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(r.id); else next.delete(r.id);
                    return next;
                  })}
                  onAssign={(patch) => run(`assign-${r.id}`, () => window.screenflow.setReceiverAssignment(r.id, patch))}
                  onConnect={() => run(`connect-${r.id}`, () => window.screenflow.connectReceiver(r.id), `Conectando ${r.name}…`)}
                  onDisconnect={() => run(`disconnect-${r.id}`, () => window.screenflow.disconnectReceiver(r.id), `${r.name} desconectado.`)}
                  busy={busy === `connect-${r.id}` || busy === `disconnect-${r.id}`}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {showApk && <ApkModal host={host} onClose={() => setShowApk(false)} />}
      {appPickerFor && (
        <AppPicker display={appPickerFor} onClose={() => setAppPickerFor(null)} onDone={(text, ok) => { notify(ok ? 'ok' : 'error', text); setAppPickerFor(null); loadDisplays(); }} />
      )}
    </div>
  );
};

// ------------------------------------------------------------------ screen map

const ScreenMap: React.FC<{
  displays: PcDisplay[];
  selectedId: string;
  onSelect: (id: string) => void;
  receiverName: (id: string) => string;
}> = ({ displays, selectedId, onSelect, receiverName }) => {
  const layout = useMemo(() => {
    if (!displays.length) return null;
    const minX = Math.min(...displays.map((d) => d.bounds.x));
    const minY = Math.min(...displays.map((d) => d.bounds.y));
    const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
    const maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));
    return { minX, minY, width: maxX - minX, height: maxY - minY };
  }, [displays]);
  if (!layout) return <div className="h-40 rounded-xl bg-neutral-100 grid place-items-center text-xs text-neutral-500">Detectando telas…</div>;
  const aspect = layout.width / layout.height;
  return (
    <div className="rounded-xl bg-neutral-100 p-4">
      <div className="relative mx-auto" style={{ aspectRatio: String(aspect), maxHeight: 260, width: `min(100%, ${260 * aspect}px)` }}>
        {displays.map((d) => {
          const left = ((d.bounds.x - layout.minX) / layout.width) * 100;
          const top = ((d.bounds.y - layout.minY) / layout.height) * 100;
          const width = (d.bounds.width / layout.width) * 100;
          const height = (d.bounds.height / layout.height) * 100;
          const selected = d.id === selectedId;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => onSelect(d.id)}
              aria-pressed={selected}
              aria-label={`${d.virtual && d.assignedReceiverIds.length > 0 ? receiverName(d.assignedReceiverIds[0]) : d.label} ${d.width}×${d.height}`}
              className={clsx('absolute overflow-hidden rounded-md border-2 text-left transition',
                selected ? 'border-neutral-900 shadow-lg z-10' : 'border-neutral-400 hover:border-neutral-700',
                d.virtual ? 'bg-indigo-50' : 'bg-white')}
              style={{ left: `${left}%`, top: `${top}%`, width: `calc(${width}% - 4px)`, height: `calc(${height}% - 4px)`, margin: 2 }}
            >
              {d.thumbnail && <img src={d.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" draggable={false} />}
              <div className="relative h-full w-full p-1.5 flex flex-col justify-between bg-gradient-to-t from-white/90 via-white/30 to-transparent">
                <div className="flex flex-wrap gap-1">
                  {d.primary && <span className="rounded bg-neutral-900 px-1 text-[9px] font-bold text-white">PRINCIPAL</span>}
                  {d.virtual && <span className="rounded bg-indigo-600 px-1 text-[9px] font-bold text-white">ESTENDIDA</span>}
                </div>
                <div>
                  <div className="truncate text-[11px] font-bold text-neutral-900">
                    {d.virtual && d.assignedReceiverIds.length > 0 ? receiverName(d.assignedReceiverIds[0]) : d.label}
                  </div>
                  <div className="text-[10px] text-neutral-700 tabular-nums">{d.width}×{d.height} · {d.refreshRate} Hz</div>
                  {d.assignedReceiverIds.map((id) => (
                    <div key={id} className="truncate text-[10px] font-semibold text-emerald-700">→ {receiverName(id)}</div>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ display details

const DisplayDetails: React.FC<{
  display: PcDisplay;
  primary: PcDisplay | null;
  busy: boolean;
  receiverName: (id: string) => string;
  onResolution: (w: number, h: number, hz: number) => void;
  onPrimary: () => void;
  onPosition: (x: number, y: number) => void;
  onOpenApp: () => void;
}> = ({ display, primary, busy, receiverName, onResolution, onPrimary, onPosition, onOpenApp }) => {
  const [res, setRes] = useState(`${display.width}x${display.height}`);
  const [hz, setHz] = useState(display.refreshRate || 60);
  const options = useMemo(() => {
    const list = RESOLUTIONS.map(([w, h]) => `${w}x${h}`);
    const current = `${display.width}x${display.height}`;
    return list.includes(current) ? list : [current, ...list];
  }, [display.width, display.height]);
  const rates = REFRESH_RATES.includes(display.refreshRate) || !display.refreshRate ? REFRESH_RATES : [display.refreshRate, ...REFRESH_RATES];
  const canEdit = Boolean(display.deviceName);
  const pw = primary?.width ?? 1920, ph = primary?.height ?? 1080;

  return (
    <div className="rounded-xl border border-neutral-200 p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-neutral-900">{display.label}</h3>
          <p className="text-[11px] text-neutral-500">
            {display.width}×{display.height} · {display.refreshRate} Hz · escala {Math.round(display.scaleFactor * 100)}%
            {display.deviceName && <> · <span className="font-mono">{display.deviceName.replace('\\\\.\\', '')}</span></>}
          </p>
          {display.assignedReceiverIds.length > 0 && (
            <p className="text-[11px] font-semibold text-emerald-700 mt-0.5">Exibindo em: {display.assignedReceiverIds.map(receiverName).join(', ')}</p>
          )}
        </div>
        <button className={btnSecondary} onClick={onOpenApp}>Abrir aplicativo nesta tela</button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-neutral-600 flex flex-col gap-1">
          Resolução
          <select className={selectCls} value={res} onChange={(e) => setRes(e.target.value)} disabled={!canEdit}>
            {options.map((o) => <option key={o} value={o}>{o.replace('x', '×')}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-neutral-600 flex flex-col gap-1">
          Taxa
          <select className={selectCls} value={hz} onChange={(e) => setHz(Number(e.target.value))} disabled={!canEdit}>
            {rates.map((r) => <option key={r} value={r}>{r} Hz</option>)}
          </select>
        </label>
        <button className={btnPrimary} disabled={busy || !canEdit} onClick={() => { const [w, h] = res.split('x').map(Number); onResolution(w, h, hz); }}>
          Aplicar
        </button>
        {!display.primary && (
          <button className={btnSecondary} disabled={busy || !canEdit} onClick={onPrimary}>Tornar principal</button>
        )}
      </div>

      {!display.primary && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-neutral-600 mr-1">Posição em relação à principal:</span>
          <button className={btnSecondary} disabled={busy || !canEdit} onClick={() => onPosition(-display.width, 0)}>← Esquerda</button>
          <button className={btnSecondary} disabled={busy || !canEdit} onClick={() => onPosition(pw, 0)}>Direita →</button>
          <button className={btnSecondary} disabled={busy || !canEdit} onClick={() => onPosition(0, -display.height)}>↑ Acima</button>
          <button className={btnSecondary} disabled={busy || !canEdit} onClick={() => onPosition(0, ph)}>↓ Abaixo</button>
        </div>
      )}
      {!canEdit && <p className="text-[11px] text-amber-700">O Windows não identificou esta tela; os ajustes ficam indisponíveis.</p>}
    </div>
  );
};

// ------------------------------------------------------------------ receiver card

const ReceiverCard: React.FC<{
  receiver: DisplayReceiver;
  host: HostInfo | null;
  displays: PcDisplay[];
  selected: boolean;
  busy: boolean;
  globalPresetLabel: string;
  onSelect: (checked: boolean) => void;
  onAssign: (patch: Partial<DisplayReceiver['assignment']>) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}> = ({ receiver: r, host, displays, selected, busy, globalPresetLabel, onSelect, onAssign, onConnect, onDisconnect }) => {
  const status = statusOf(r, host);
  const active = Boolean(r.session);
  const presetValue = r.assignment.quality?.preset ?? 'global';
  const fpsValue = (r.assignment.quality ?? useMasterStore.getState().settings.display?.quality)?.fps === 30 ? 30 : 60;
  const quality = r.session?.quality;
  const globalAudioEnabled = useMasterStore.getState().settings.display.audio?.enabled ?? true;
  const audioValue = r.assignment.audio === true ? 'on' : r.assignment.audio === false ? 'off' : 'default';
  return (
    <article className={clsx('rounded-xl border p-3 space-y-2.5', selected ? 'border-neutral-900' : 'border-neutral-200')}>
      <div className="flex items-start gap-2.5">
        <input type="checkbox" className="mt-1" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Selecionar ${r.name}`} />
        <div className="h-9 w-9 shrink-0 rounded-lg bg-neutral-900 text-white grid place-items-center" aria-hidden="true">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="4" y="2.5" width="16" height="19" rx="2.5" /><path d="M10 18.5h4" /></svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-bold text-neutral-900">{r.name}</h3>
            <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', status.tone)}>{status.label}</span>
          </div>
          <p className="text-[11px] text-neutral-500 truncate">
            {[r.manufacturer, r.model].filter(Boolean).join(' ')} · <span className="font-mono">{r.ip}</span> · {r.width}×{r.height} · {r.refreshRate} Hz
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-neutral-600 flex flex-col gap-1">
          Modo
          <select className={selectCls} value={r.assignment.mode} onChange={(e) => onAssign({ mode: e.target.value as ReceiverMode })}>
            <option value="extend">Estender (tela extra)</option>
            <option value="mirror">Duplicar (espelho)</option>
          </select>
        </label>
        {r.assignment.mode === 'mirror' ? (
          <label className="text-[11px] text-neutral-600 flex flex-col gap-1">
            Tela de origem
            <select className={selectCls} value={r.assignment.sourceDisplayId || displays.find((d) => d.primary)?.id || ''} onChange={(e) => onAssign({ sourceDisplayId: e.target.value })}>
              {displays.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
        ) : <div />}
        <label className="text-[11px] text-neutral-600 flex flex-col gap-1">
          Qualidade
          <select
            className={selectCls}
            value={presetValue}
            onChange={(e) => {
              const value = e.target.value as QualityPreset | 'global';
              const base = r.assignment.quality ?? useMasterStore.getState().settings.display.quality;
              onAssign({ quality: value === 'global' ? null : { ...base, preset: value } });
            }}
          >
            <option value="global">Padrão das Opções ({globalPresetLabel})</option>
            {(['economy', 'balanced', 'high', 'ultra', 'native'] as QualityPreset[]).map((p) => <option key={p} value={p}>{QUALITY_PRESET_LABELS[p]}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-neutral-600 flex flex-col gap-1">
          Quadros por segundo
          <select
            className={selectCls}
            value={fpsValue}
            onChange={(e) => {
              const fps = Number(e.target.value);
              const base = r.assignment.quality ?? useMasterStore.getState().settings.display.quality;
              onAssign({ quality: { ...base, fps } });
            }}
          >
            {PRESET_FPS_OPTIONS.map((fps) => <option key={fps} value={fps}>{fps} fps{fps === 60 ? ' (mais fluido)' : ' (menos banda)'}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-neutral-600 flex flex-col gap-1 col-span-2">
          Som
          <select
            className={selectCls}
            value={audioValue}
            onChange={(e) => {
              const val = e.target.value;
              onAssign({ audio: val === 'on' ? true : val === 'off' ? false : null });
            }}
          >
            <option value="default">Padrão das Opções ({globalAudioEnabled ? 'ligado' : 'desligado'})</option>
            <option value="on">Enviar som do PC</option>
            <option value="off">Sem som</option>
          </select>
        </label>
      </div>

      {r.session && (
        <div className="rounded-lg bg-neutral-50 px-2.5 py-2 text-[11px] text-neutral-700 space-y-0.5">
          <div className="font-semibold text-neutral-900">{r.session.label}</div>
          <div className="text-[11px] font-medium text-neutral-600">
            {r.session.transport === 'native'
              ? `Tempo real · ${r.session.encoder || 'H.264'} → ${r.session.decoder || 'MediaCodec'}`
              : 'WebRTC'}
          </div>
          {quality && (
            <div className="tabular-nums">
              Alvo: {quality.width}×{quality.height} · {quality.fps} fps · {(quality.bitrateKbps / 1000).toFixed(0)} Mbps · {quality.codec} · {r.session.audio ? '🔊 Som' : 'Sem som'}
            </div>
          )}
          {r.stats && (
            <div className="tabular-nums text-emerald-700">
              Recebendo: {r.stats.width}×{r.stats.height} · {r.stats.fps} fps · {r.stats.mbps.toFixed(1)} Mbps
              {r.stats.bitrateKbps != null && (
                <> · bitrate atual {(r.stats.bitrateKbps / 1000).toFixed(1)} Mbps</>
              )}
              {r.stats.queueMs != null && (
                <> · fila {r.stats.queueMs} ms</>
              )}
              {quality && r.stats.bitrateKbps != null && r.stats.bitrateKbps < quality.bitrateKbps && (
                <span className="text-amber-600 font-medium"> (adaptando à rede)</span>
              )}
              {' '}· latência {r.stats.rttMs} ms · jitter {r.stats.jitterMs} ms · buffer {r.stats.bufferMs ?? 0} ms
            </div>
          )}
          {r.session.error && <div className={r.session.status === 'error' ? 'text-rose-700' : 'text-amber-700'}>{r.session.error}</div>}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-neutral-600">
          <input type="checkbox" checked={r.assignment.autoConnect} onChange={(e) => onAssign({ autoConnect: e.target.checked })} />
          Reconectar automaticamente
        </label>
        {active ? (
          <button className={btnDanger} disabled={busy} onClick={onDisconnect}>Desconectar</button>
        ) : (
          <button className={btnPrimary} disabled={busy || !r.online} onClick={onConnect}>
            {busy ? 'Conectando…' : r.assignment.mode === 'extend' ? 'Estender para este aparelho' : 'Duplicar neste aparelho'}
          </button>
        )}
      </div>
    </article>
  );
};

// ------------------------------------------------------------------ empty state / modals

const EmptyReceivers: React.FC<{ scanning: boolean; host: HostInfo | null; onShowApk: () => void }> = ({ scanning, host, onShowApk }) => (
  <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-center space-y-2">
    <p className="text-sm font-semibold text-neutral-800">{scanning ? 'Procurando aparelhos…' : 'Nenhum aparelho encontrado'}</p>
    <ol className="text-xs text-neutral-600 space-y-1 inline-block text-left list-decimal list-inside">
      <li>Instale o app <strong>SpaceViewer Display</strong> no tablet ou celular (<button className="underline" onClick={onShowApk}>QR code</button>).</li>
      <li>Abra o app e conecte o aparelho ao mesmo Wi-Fi deste PC{host?.ip ? ` (${host.ip})` : ''}.</li>
      <li>Clique em <strong>Buscar</strong>. Se não aparecer, digite o IP mostrado no aparelho e clique em <strong>Adicionar</strong>.</li>
    </ol>
  </div>
);

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={clsx('w-full rounded-2xl bg-white p-5 shadow-2xl max-h-[85vh] overflow-y-auto', wide ? 'max-w-3xl' : 'max-w-md')} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-neutral-900">{title}</h2>
          <button className="text-neutral-500 hover:text-neutral-900 px-2" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
};

const ApkModal: React.FC<{ host: HostInfo | null; onClose: () => void }> = ({ host, onClose }) => (
  <Modal title="Instalar o SpaceViewer Display" onClose={onClose}>
    {host?.apkUrl ? (
      <div className="space-y-3 text-center">
        <QRCodeDisplay value={host.apkUrl} size={180} />
        <p className="text-xs text-neutral-600">Leia o QR code com a câmera do aparelho (mesma rede Wi-Fi) ou abra no navegador dele:</p>
        <p className="font-mono text-xs font-bold text-neutral-900 break-all">{host.apkUrl}</p>
        <p className="text-[11px] text-neutral-500">O Android pedirá permissão para instalar apps desta fonte. Depois de instalar, abra o app e clique em Buscar aqui no PC.</p>
      </div>
    ) : (
      <p className="text-xs text-neutral-600">O APK não está incluído nesta instalação. Gere-o com <span className="font-mono">npm run build:apk</span>.</p>
    )}
  </Modal>
);

const AppPicker: React.FC<{ display: PcDisplay; onClose: () => void; onDone: (text: string, ok: boolean) => void }> = ({ display, onClose, onDone }) => {
  const [apps, setApps] = useState<AppWindowSource[] | null>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    window.screenflow.getAppWindows().then(setApps).catch(() => setApps([]));
  }, []);
  const visible = (apps ?? []).filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()));
  const move = async (app: AppWindowSource) => {
    const result = await window.screenflow.moveWindowToScreen(app.name, display.id, app.id);
    onDone(result.success ? `"${app.name.slice(0, 40)}" movido para ${display.label}.` : result.error || 'Não foi possível mover a janela.', result.success);
  };
  const project = async (app: AppWindowSource) => {
    const result = await window.screenflow.startAppProjector(app.id, app.name, display.id);
    onDone(result.success ? `Projetando "${app.name.slice(0, 40)}" em ${display.label}.` : result.error || 'Falha ao projetar.', result.success);
  };
  return (
    <Modal title={`Abrir aplicativo em: ${display.label}`} onClose={onClose} wide>
      <div className="flex items-center gap-2 mb-3">
        <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar janelas…" className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-xs" />
        <button className={btnSecondary} onClick={() => window.screenflow.stopAppProjector(display.id).then(() => onDone('Projeção encerrada.', true))}>Parar projeção</button>
      </div>
      {apps === null ? <p className="text-xs text-neutral-500">Carregando janelas…</p> : visible.length === 0 ? (
        <p className="text-xs text-neutral-500">Nenhuma janela encontrada.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {visible.map((app) => (
            <li key={app.id} className="flex items-center gap-3 py-2">
              {app.appIcon ? <img src={app.appIcon} alt="" className="h-6 w-6" /> : <div className="h-6 w-6 rounded bg-neutral-200" />}
              <span className="flex-1 truncate text-xs text-neutral-800">{app.name}</span>
              <button className={btnSecondary} onClick={() => move(app)} title="Move a janela original para esta tela">Mover janela</button>
              <button className={btnPrimary} onClick={() => project(app)} title="Mostra uma cópia ao vivo da janela nesta tela">Projetar</button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};

export default ScreensPanel;
