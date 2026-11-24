// ============================================================
// SpaceViewer — receiver sessions: prepares the PC display (virtual for "extend",
// existing monitor for "mirror"), asks the APK to connect and hands the stream to
// the renderer or to the native FFmpeg transport. See docs/ARQUITETURA-TELA-ESTENDIDA.md §5.3 / §3.5.
// ============================================================

import { randomUUID } from 'crypto';
import * as os from 'os';
import { EventEmitter } from 'events';
import Store from 'electron-store';
import { DisplayReceivers, DiscoveredDevice } from './display-receivers';
import {
  attachVirtualDisplay,
  attachVirtualOutput,
  closestVirtualMode,
  detachVirtualDisplay,
  listPcDisplays,
  VIRTUAL_MODES,
  waitForElectronDisplays,
} from './display-topology';
import type { SignalingServer } from './signaling';
import { resolveQuality } from '../shared/constants';
import { ffmpegPath, probeEncoders } from './native-encoder';
import { NativeStreamSession } from './native-stream';
import { log } from './diagnostics-log';
import type {
  AppSettings,
  DisplayActionResult,
  DisplayQuality,
  DisplayReceiver,
  DisplaySessionReady,
  PcDisplay,
  ReceiverAssignment,
  ReceiverMode,
  ReceiverSession,
  ReceiverStats,
} from '../shared/types';

export { closestVirtualMode, VIRTUAL_MODES };

const DEFAULT_ASSIGNMENT: ReceiverAssignment = { mode: 'extend', sourceDisplayId: '', quality: null, audio: null, autoConnect: true };
const CONNECT_TIMEOUT_MS = 20000;

interface ActiveSession extends ReceiverSession {
  receiverId: string;
  connectTimer?: NodeJS.Timeout;
  stopping?: boolean;
  nativeSession?: NativeStreamSession;
  forceWebRtc?: boolean;
  readyReceived?: boolean;
  lastRecoverAt?: number;
}

interface Dependencies {
  settings: () => AppSettings;
  signaling: () => SignalingServer | null;
  /** Reason the signaling server is down, when known. */
  signalingError?: () => string | null;
  receivers: DisplayReceivers;
}

function localAddressFor(remoteIp: string): string {
  const remote = remoteIp.split('.').map(Number);
  let fallback = '';
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      fallback ||= entry.address;
      const local = entry.address.split('.').map(Number);
      const mask = (entry.netmask || '255.255.255.0').split('.').map(Number);
      if (remote.length === 4 && local.every((part, i) => (part & mask[i]) === (remote[i] & mask[i]))) return entry.address;
    }
  }
  return fallback || '127.0.0.1';
}

export class DisplaySessions extends EventEmitter {
  private assignments: Store<{ receiverAssignments: Record<string, ReceiverAssignment> }>;
  private sessions = new Map<string, ActiveSession>();
  private stats = new Map<string, ReceiverStats>();
  /** Receivers the user disconnected during this run; auto-connect leaves them alone. */
  private manuallyStopped = new Set<string>();
  /** Per-device fallback flag so failing native sessions switch to webrtc once without looping. */
  private forcedWebRtc = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private deps: Dependencies) {
    super();
    this.assignments = new Store({ name: 'receivers', defaults: { receiverAssignments: {} } });
    deps.receivers.on('updated', () => {
      this.emitUpdate();
      this.autoConnect();
    });
  }

  // ---------------------------------------------------------------- state

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  getAssignment(id: string): ReceiverAssignment {
    return { ...DEFAULT_ASSIGNMENT, ...(this.assignments.get('receiverAssignments')[id] || {}) };
  }

  private effectiveQuality(device: DiscoveredDevice | undefined, assignment: ReceiverAssignment): DisplayQuality {
    const base = assignment.quality ?? this.deps.settings().display.quality;
    return resolveQuality(base, device);
  }

  private effectiveAudio(assignment: ReceiverAssignment): boolean {
    return assignment.audio ?? this.deps.settings().display.audio.enabled;
  }

  list(): DisplayReceiver[] {
    return this.deps.receivers.list().map((device) => {
      const session = this.sessions.get(device.id);
      return {
        ...device,
        online: this.deps.receivers.isOnline(device.id),
        assignment: this.getAssignment(device.id),
        session: session ? this.publicSession(session) : null,
        stats: session?.status === 'streaming' ? this.stats.get(device.id) ?? null : null,
      };
    });
  }

  private publicSession(s: ActiveSession): ReceiverSession {
    return {
      sessionId: s.sessionId,
      agentId: s.agentId,
      mode: s.mode,
      transport: s.transport,
      encoder: s.encoder ?? s.nativeSession?.encoder,
      decoder: s.decoder ?? s.nativeSession?.decoder,
      displayId: s.displayId,
      virtualDeviceName: s.virtualDeviceName,
      label: s.label,
      status: s.status,
      error: s.error,
      quality: s.quality,
      audio: s.audio,
    };
  }

  /** Electron display id -> receiver ids streaming it (for the screen map). */
  displayAssignments(): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    for (const s of this.sessions.values()) if (s.displayId) (map[s.displayId] ||= []).push(s.receiverId);
    return map;
  }

  private emitUpdate() {
    this.emit('updated', this.list());
  }

  isExpectedSession(sessionId: string, deviceId: string): boolean {
    const session = this.sessions.get(deviceId);
    return Boolean(session && !session.stopping && session.sessionId === sessionId);
  }

  hasNativeAudio(): boolean {
    for (const s of this.sessions.values()) {
      if (s.transport === 'native' && s.audio && (s.status === 'streaming' || s.status === 'connecting')) {
        return true;
      }
    }
    return false;
  }

  onNativeAudio(chunk: Buffer): void {
    for (const s of this.sessions.values()) {
      if (s.transport === 'native' && s.audio && s.nativeSession) {
        s.nativeSession.sendAudio(chunk);
      }
    }
  }

  // ---------------------------------------------------------------- assignment

  setAssignment(id: string, patch: Partial<ReceiverAssignment>): Promise<DisplayActionResult> {
    const previous = this.getAssignment(id);
    const next: ReceiverAssignment = { ...previous, ...patch };
    const all = { ...this.assignments.get('receiverAssignments'), [id]: next };
    this.assignments.set('receiverAssignments', all);
    this.emitUpdate();
    const session = this.sessions.get(id);
    if (!session) return Promise.resolve({ success: true });
    if (previous.mode !== next.mode) {
      return this.serialize(async () => {
        await this.stopInternal(id, false);
        return this.startInternal(id);
      });
    }
    const changed = previous.sourceDisplayId !== next.sourceDisplayId ||
      JSON.stringify(previous.quality) !== JSON.stringify(next.quality) ||
      previous.audio !== next.audio;
    return changed ? this.serialize(() => this.reconfigure(id)) : Promise.resolve({ success: true });
  }

  private getActiveNativeSessions(): NativeStreamSession[] {
    const active: NativeStreamSession[] = [];
    for (const s of this.sessions.values()) {
      if (s.transport === 'native' && s.nativeSession && !s.stopping) {
        active.push(s.nativeSession);
      }
    }
    return active;
  }

  private updateBandwidthBudgets(): void {
    const nativeSessions = this.getActiveNativeSessions();
    const count = nativeSessions.length;
    if (count === 0) return;
    const total = this.deps.settings().display.totalBitrateKbps ?? 20000;
    const budgetPerSession = Math.floor(total / count);
    log('budget', 'Updating bandwidth budget per session', {
      totalBitrateKbps: total,
      activeSessionsCount: count,
      budgetPerSession,
    });
    for (const session of nativeSessions) {
      session.setBudgetKbps(budgetPerSession);
    }
  }

  /** Global quality changed in Settings: reconfigure sessions that follow it. */
  onGlobalQualityChanged(): void {
    this.updateBandwidthBudgets();
    for (const id of this.sessions.keys()) {
      const assignment = this.getAssignment(id);
      if (!assignment.quality || assignment.audio == null) {
        this.serialize(() => this.reconfigure(id)).catch(() => {});
      }
    }
  }

  // ---------------------------------------------------------------- public actions

  connect(id: string): Promise<DisplayActionResult> {
    this.manuallyStopped.delete(id);
    this.forcedWebRtc.delete(id);
    return this.serialize(() => this.startInternal(id));
  }

  disconnect(id: string): Promise<DisplayActionResult> {
    this.manuallyStopped.add(id);
    this.forcedWebRtc.delete(id);
    return this.serialize(() => this.stopInternal(id, true));
  }

  disconnectAll(): Promise<DisplayActionResult> {
    for (const id of this.sessions.keys()) {
      this.manuallyStopped.add(id);
      this.forcedWebRtc.delete(id);
    }
    return this.serialize(async () => {
      for (const id of [...this.sessions.keys()]) await this.stopInternal(id, true);
      return { success: true };
    });
  }

  /** Bulk action from the Telas screen: set the mode on every id and (re)connect them. */
  applyMode(ids: string[], mode: ReceiverMode, sourceDisplayId?: string): Promise<DisplayActionResult> {
    for (const id of ids) {
      const all = this.assignments.get('receiverAssignments');
      all[id] = { ...this.getAssignment(id), mode, ...(mode === 'mirror' ? { sourceDisplayId: sourceDisplayId ?? '' } : {}) };
      this.assignments.set('receiverAssignments', all);
      this.manuallyStopped.delete(id);
      this.forcedWebRtc.delete(id);
    }
    this.emitUpdate();
    return this.serialize(async () => {
      const errors: string[] = [];
      for (const id of ids) {
        const session = this.sessions.get(id);
        if (session && session.mode !== mode) await this.stopInternal(id, false);
        const result = this.sessions.has(id) ? await this.reconfigure(id) : await this.startInternal(id);
        if (!result.success) errors.push(`${this.deps.receivers.get(id)?.name ?? id}: ${result.error}`);
      }
      return errors.length ? { success: false, error: errors.join('\n') } : { success: true };
    });
  }

  reportStatus(receiverId: string, status: 'streaming' | 'error', error?: string): void {
    const session = this.sessions.get(receiverId);
    if (!session) return;
    session.status = status;
    session.error = status === 'error' ? error || 'Falha na transmissão.' : undefined;
    this.emitUpdate();
  }

  reportNotice(receiverId: string, message: string): void {
    void receiverId;
    this.emit('notice', message);
  }

  // ---------------------------------------------------------------- signaling events

  onDisplayConnected(event: { agentId: string; deviceId: string; sessionId: string }): void {
    const session = this.sessions.get(event.deviceId);
    if (!session || session.sessionId !== event.sessionId) return;
    if (session.connectTimer) clearTimeout(session.connectTimer);
    session.connectTimer = undefined;
    session.agentId = event.agentId;
    session.status = 'connecting';
    session.error = undefined;
    this.emitUpdate();
    this.emitReady(session).catch((error) => this.fail(session, (error as Error).message));
  }

  onDisplayMessage(event: { agentId: string; deviceId: string; sessionId?: string; type: string; payload: any }): void {
    if (event.type === 'display-stats') {
      const p = event.payload || {};
      this.stats.set(event.deviceId, {
        fps: Number(p.fps) || 0, mbps: Number(p.mbps) || 0, rttMs: Number(p.rttMs) || 0,
        width: Number(p.width) || 0, height: Number(p.height) || 0,
        packetsLost: Number(p.packetsLost) || 0, jitterMs: Number(p.jitterMs) || 0,
        bufferMs: Number(p.bufferMs) || 0,
      });
      this.emitUpdate();
      return;
    }
    if (event.type === 'webrtc-recover') {
      const session = this.sessions.get(event.deviceId);
      if (!session || session.stopping || (event.sessionId && session.sessionId !== event.sessionId)) return;
      const now = Date.now();
      if (now - (session.lastRecoverAt ?? 0) < 3000) return;
      session.lastRecoverAt = now;
      session.agentId = event.agentId;
      session.status = 'connecting';
      session.error = 'Recuperando transmissão de vídeo…';
      log('session', 'WebRTC recovery requested by receiver', {
        receiverId: event.deviceId,
        reason: event.payload?.reason,
      });
      this.emitUpdate();
      this.emitReady(session).catch((error) => this.fail(session, (error as Error).message));
      return;
    }
    if (event.type === 'webrtc-answer' || event.type === 'ice-candidate') {
      this.emit('signal', { fromId: event.agentId, type: event.type, payload: event.payload });
    }
  }

  onDisplayDisconnected(event: { agentId: string; deviceId: string }): void {
    const session = this.sessions.get(event.deviceId);
    this.emit('session-ended', { receiverId: event.deviceId, agentId: event.agentId, reconfigure: false });
    if (!session || session.stopping || session.agentId !== event.agentId) return;
    // The APK retries for 60 s with the same sessionId; keep the display reserved meanwhile.
    session.agentId = undefined;
    session.status = 'connecting';
    session.error = 'Conexão perdida. Aguardando o aparelho reconectar…';
    this.armConnectTimeout(session, 65000);
    this.emitUpdate();
  }

  // ---------------------------------------------------------------- internals

  private autoConnect() {
    if (!this.deps.settings().display.autoReconnect) return;
    for (const device of this.deps.receivers.list()) {
      const assignment = this.getAssignment(device.id);
      if (!assignment.autoConnect || this.sessions.has(device.id) || this.manuallyStopped.has(device.id)) continue;
      if (!this.deps.receivers.isOnline(device.id) || device.state !== 'idle') continue;
      // Only reconnect devices that were configured before (explicit assignment saved).
      if (!this.assignments.get('receiverAssignments')[device.id]) continue;
      this.serialize(() => this.sessions.has(device.id) ? Promise.resolve({ success: true }) : this.startInternal(device.id)).catch(() => {});
    }
  }

  private async pickDisplay(session: ActiveSession, assignment: ReceiverAssignment): Promise<PcDisplay> {
    const displays = await listPcDisplays({}, false);
    const source = displays.find((d) => d.id === assignment.sourceDisplayId) ?? displays.find((d) => d.primary) ?? displays[0];
    if (!source) throw new Error('Nenhum monitor disponível para espelhar.');
    return source;
  }

  private async prepare(session: ActiveSession): Promise<void> {
    const device = this.deps.receivers.get(session.receiverId);
    const assignment = this.getAssignment(session.receiverId);
    const quality = this.effectiveQuality(device, assignment);
    session.audio = this.effectiveAudio(assignment);

    if (session.mode === 'extend') {
      const busyDeviceNames = [...this.sessions.values()]
        .filter((s) => s !== session && s.mode === 'extend' && s.virtualDeviceName)
        .map((s) => s.virtualDeviceName as string);

      if (!session.virtualDeviceName) {
        const attached = await attachVirtualDisplay(quality.width, quality.height, quality.fps, busyDeviceNames);
        if (!attached.success || !attached.display) {
          throw new Error(attached.error || 'Falha ao anexar a tela estendida.');
        }
        session.virtualDeviceName = attached.display.deviceName;
        session.displayId = attached.display.id;
        session.quality = {
          ...quality,
          width: attached.display.width,
          height: attached.display.height,
          fps: attached.display.refreshRate || quality.fps,
        };
      } else {
        const displays = await listPcDisplays({}, false);
        const currentDisplay = displays.find((d) => d.deviceName === session.virtualDeviceName);
        let x = currentDisplay?.bounds.x ?? 0;
        let y = currentDisplay?.bounds.y ?? 0;
        if (!currentDisplay) {
          let maxX = 0;
          for (const d of displays) {
            if (d.deviceName !== session.virtualDeviceName) {
              maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
            }
          }
          x = maxX;
          y = 0;
        }

        let reattach = await attachVirtualOutput(session.virtualDeviceName, x, y, quality.width, quality.height, quality.fps);
        let finalW = quality.width;
        let finalH = quality.height;
        let finalFps = quality.fps;
        if (!reattach.success) {
          const [cw, ch] = closestVirtualMode(quality.width, quality.height);
          reattach = await attachVirtualOutput(session.virtualDeviceName, x, y, cw, ch, 60);
          finalW = cw;
          finalH = ch;
          finalFps = 60;
        }
        if (!reattach.success) {
          throw new Error(reattach.error || 'Falha ao reconfigurar a tela estendida.');
        }
        const updatedDisplays = await waitForElectronDisplays((list) =>
          list.some((d) => d.deviceName === session.virtualDeviceName && d.width === finalW && d.height === finalH)
        );
        const display = updatedDisplays.find((d) => d.deviceName === session.virtualDeviceName) ?? currentDisplay;
        if (display) {
          session.displayId = display.id;
          session.quality = {
            ...quality,
            width: display.width,
            height: display.height,
            fps: display.refreshRate || finalFps,
          };
        }
      }
      const deviceName = device?.name ?? session.receiverId;
      session.label = `Tela de ${deviceName} (estendida)`;
    } else {
      const display = await this.pickDisplay(session, assignment);
      session.displayId = display.id;
      session.virtualDeviceName = undefined;
      session.quality = quality;
      session.label = `Espelho de ${display.label}`;
    }
  }

  private async shouldUseNative(device: DiscoveredDevice | undefined, session: ActiveSession): Promise<boolean> {
    if (session.forceWebRtc) return false;
    const transportSetting = this.deps.settings().display.transport ?? 'webrtc';
    if (transportSetting !== 'native') return false;
    if (!device?.capabilities?.includes('native-h264')) return false;
    if (!ffmpegPath()) return false;
    const encoders = await probeEncoders().catch(() => []);
    return encoders.length > 0;
  }

  private async startInternal(id: string): Promise<DisplayActionResult> {
    if (this.sessions.has(id)) return { success: true };
    const device = this.deps.receivers.get(id);
    if (!device) return { success: false, error: 'Aparelho não encontrado. Clique em Buscar.' };
    const signaling = this.deps.signaling();
    if (!signaling?.isRunning) {
      return { success: false, error: this.deps.signalingError?.() || 'O servidor do SpaceViewer não está ativo. Verifique a porta em Opções → Servidor.' };
    }
    const assignment = this.getAssignment(id);
    const session: ActiveSession = {
      receiverId: id,
      sessionId: randomUUID(),
      mode: assignment.mode,
      label: device.name,
      status: 'preparing',
      quality: this.effectiveQuality(device, assignment),
      audio: this.effectiveAudio(assignment),
      forceWebRtc: this.forcedWebRtc.has(id),
    };
    this.sessions.set(id, session);
    this.deps.receivers.pinned.add(id);
    this.emitUpdate();
    try {
      await this.prepare(session);
      this.emitUpdate();

      const useNative = await this.shouldUseNative(device, session);
      session.transport = useNative ? 'native' : 'webrtc';

      if (useNative) {
        session.status = 'connecting';
        this.emitUpdate();

        await this.deps.receivers.connect(id, {
          host: localAddressFor(device.ip),
          port: signaling.listeningPort,
          masterName: os.hostname(),
          sessionId: session.sessionId,
          mode: session.mode,
          label: session.label,
          orientation: session.quality.orientation,
          transport: 'native',
          streamPort: device.streamPort || 47813,
        });

        const display = (await listPcDisplays({}, false)).find((d) => d.id === session.displayId)
          ?? (await this.pickDisplay(session, assignment));

        const nativeSession = new NativeStreamSession({
          receiverId: id,
          host: device.ip,
          port: device.streamPort || 47813,
          display,
          quality: session.quality,
          audio: session.audio,
          label: session.label,
          sessionId: session.sessionId,
        });
        session.nativeSession = nativeSession;
        this.updateBandwidthBudgets();

        nativeSession.on('ready', ({ decoder, encoder }) => {
          if (this.sessions.get(id) !== session) return;
          session.readyReceived = true;
          session.status = 'streaming';
          session.decoder = decoder;
          session.encoder = encoder;
          session.error = undefined;
          log('session', 'Native session ready', {
            receiverId: id,
            receiverName: device?.name,
            mode: session.mode,
            transport: 'native',
            encoder,
            decoder,
            quality: session.quality,
          });
          this.emitUpdate();
          this.emit('native-audio-state', { enabled: this.hasNativeAudio() });
        });

        nativeSession.on('stats', (stats) => {
          if (this.sessions.get(id) !== session) return;
          this.stats.set(id, stats);
          this.emitUpdate();
        });

        nativeSession.on('fallback', (reason) => {
          if (this.sessions.get(id) !== session) return;
          this.handleNativeFallback(id, session, reason);
        });

        nativeSession.on('closed', (err?: Error) => {
          if (this.sessions.get(id) !== session) return;
          if (!session.readyReceived) {
            this.handleNativeFallback(id, session, err?.message || 'Conexão encerrada antes de iniciar.');
          } else {
            this.handleNativeDrop(id, session);
          }
        });

        Promise.resolve(nativeSession.start()).catch((err) => {
          this.handleNativeFallback(id, session, err?.message || String(err));
        });

        this.emitUpdate();
        this.emit('native-audio-state', { enabled: this.hasNativeAudio() });
        return { success: true };
      } else {
        session.status = 'connecting';
        this.armConnectTimeout(session, CONNECT_TIMEOUT_MS);
        log('session', 'WebRTC session connecting', {
          receiverId: id,
          receiverName: device.name,
          mode: session.mode,
          transport: 'webrtc',
          quality: session.quality,
        });
        await this.deps.receivers.connect(id, {
          host: localAddressFor(device.ip),
          port: signaling.listeningPort,
          masterName: os.hostname(),
          sessionId: session.sessionId,
          mode: session.mode,
          label: session.label,
          orientation: session.quality.orientation,
          transport: 'webrtc',
        });
        this.emitUpdate();
        return { success: true };
      }
    } catch (error) {
      const message = (error as Error).message;
      await this.stopInternal(id, false, true);
      this.fail(undefined, message);
      return { success: false, error: message };
    }
  }

  private handleNativeFallback(id: string, session: ActiveSession, reason: string): void {
    if (session.stopping) return;
    this.forcedWebRtc.add(id);
    log('session', 'Fallback from native to webrtc', { receiverId: id, reason });
    this.emit('notice', `Tempo real indisponível (${reason}); usando o modo compatível.`);
    this.updateBandwidthBudgets();
    this.serialize(async () => {
      await this.stopInternal(id, false, false);
      await this.startInternal(id);
    }).catch(() => {});
  }

  private handleNativeDrop(id: string, session: ActiveSession): void {
    if (session.stopping) return;
    session.status = 'connecting';
    session.error = 'Conexão perdida. Aguardando o aparelho reconectar…';
    this.emitUpdate();
    this.emit('native-audio-state', { enabled: this.hasNativeAudio() });

    const deadline = Date.now() + 60000;
    const retry = async () => {
      if (this.sessions.get(id) !== session || session.stopping) return;
      if (Date.now() > deadline) {
        this.serialize(() => this.stopInternal(id, false)).catch(() => {});
        return;
      }
      try {
        const display = (await listPcDisplays({}, false)).find((d) => d.id === session.displayId)
          ?? (await this.pickDisplay(session, this.getAssignment(id)));
        if (session.nativeSession) {
          await Promise.resolve(session.nativeSession.stop()).catch(() => {});
        }
        const device = this.deps.receivers.get(id);
        if (!device) throw new Error('Aparelho indisponível');
        const nextNative = new NativeStreamSession({
          receiverId: id,
          host: device.ip,
          port: device.streamPort || 47813,
          display,
          quality: session.quality,
          audio: session.audio,
          label: session.label,
          sessionId: session.sessionId,
        });
        session.nativeSession = nextNative;

        nextNative.on('ready', ({ decoder, encoder }) => {
          if (this.sessions.get(id) !== session) return;
          session.status = 'streaming';
          session.decoder = decoder;
          session.encoder = encoder;
          session.error = undefined;
          this.emitUpdate();
          this.emit('native-audio-state', { enabled: this.hasNativeAudio() });
        });

        nextNative.on('stats', (stats) => {
          if (this.sessions.get(id) !== session) return;
          this.stats.set(id, stats);
          this.emitUpdate();
        });

        nextNative.on('closed', () => {
          if (this.sessions.get(id) !== session || session.stopping) return;
          setTimeout(retry, 2000);
        });

        await nextNative.start();
      } catch {
        setTimeout(retry, 2000);
      }
    };
    setTimeout(retry, 1000);
  }

  private armConnectTimeout(session: ActiveSession, ms: number) {
    if (session.connectTimer) clearTimeout(session.connectTimer);
    session.connectTimer = setTimeout(() => {
      session.connectTimer = undefined;
      if (this.sessions.get(session.receiverId) !== session || session.agentId) return;
      this.serialize(() => this.stopInternal(session.receiverId, false)).then(() => {
        this.emit('notice', `${this.deps.receivers.get(session.receiverId)?.name ?? 'O aparelho'} não abriu a conexão com o PC. Verifique o firewall (porta ${this.deps.signaling()?.listeningPort ?? 7523}).`);
      }).catch(() => {});
    }, ms);
  }

  private async reconfigure(id: string): Promise<DisplayActionResult> {
    const session = this.sessions.get(id);
    if (!session) return this.startInternal(id);
    try {
      if (session.transport === 'native' && session.nativeSession) {
        session.status = 'preparing';
        this.emitUpdate();
        await this.prepare(session);
        const display = (await listPcDisplays({}, false)).find((d) => d.id === session.displayId)
          ?? (await this.pickDisplay(session, this.getAssignment(id)));
        await session.nativeSession.reconfigure(session.quality, display);
        session.status = 'streaming';
        this.emitUpdate();
        this.emit('native-audio-state', { enabled: this.hasNativeAudio() });
        return { success: true };
      }

      if (session.agentId) {
        this.emit('session-ended', { receiverId: id, agentId: session.agentId, reconfigure: true });
        this.deps.signaling()?.sendToAgent(session.agentId, { type: 'stream-stop', payload: { reason: 'reconfigure' } });
      }
      session.status = 'preparing';
      this.emitUpdate();
      await this.prepare(session);
      if (session.agentId) await this.emitReady(session);
      this.emitUpdate();
      return { success: true };
    } catch (error) {
      this.fail(session, (error as Error).message);
      return { success: false, error: (error as Error).message };
    }
  }

  private async emitReady(session: ActiveSession): Promise<void> {
    if (!session.agentId || !session.displayId) return;
    // desktopCapturer ids can change after topology changes: resolve them now.
    const display = (await listPcDisplays({}, false)).find((d) => d.id === session.displayId);
    if (!display?.sourceId) throw new Error('A tela selecionada não está disponível para captura.');
    this.deps.signaling()?.sendToAgent(session.agentId, {
      type: 'stream-config',
      payload: {
        label: session.label,
        mode: session.mode,
        width: session.quality.width,
        height: session.quality.height,
        fps: session.quality.fps,
        orientation: session.quality.orientation,
        audio: session.audio,
      },
    });
    const ready: DisplaySessionReady = {
      receiverId: session.receiverId,
      agentId: session.agentId,
      sessionId: session.sessionId,
      displayId: display.id,
      sourceId: display.sourceId,
      label: session.label,
      mode: session.mode,
      quality: session.quality,
      audio: {
        enabled: session.audio,
        bitrateKbps: this.deps.settings().display.audio.bitrateKbps,
      },
    };
    this.emit('session-ready', ready);
  }

  private fail(session: ActiveSession | undefined, message: string) {
    if (session) {
      session.status = 'error';
      session.error = message;
    }
    this.emit('notice', message);
    this.emitUpdate();
  }

  private async stopInternal(id: string, manual: boolean, keepError = false): Promise<DisplayActionResult> {
    const session = this.sessions.get(id);
    if (!session) return { success: true };
    session.stopping = true;
    if (session.connectTimer) clearTimeout(session.connectTimer);
    if (manual) {
      this.forcedWebRtc.delete(id);
    }
    log('session', 'Session stopped', {
      receiverId: id,
      mode: session.mode,
      transport: session.transport,
    });
    if (session.nativeSession) {
      await Promise.resolve(session.nativeSession.stop()).catch(() => {});
      session.nativeSession = undefined;
      this.updateBandwidthBudgets();
    }
    const signaling = this.deps.signaling();
    if (session.agentId) {
      this.emit('session-ended', { receiverId: id, agentId: session.agentId, reconfigure: false });
      signaling?.sendToAgent(session.agentId, { type: 'stream-stop', payload: { reason: 'stopped' } });
      signaling?.disconnectAgentById(session.agentId);
    }
    await this.deps.receivers.disconnect(id).catch(() => {});
    this.sessions.delete(id);
    this.stats.delete(id);
    this.deps.receivers.pinned.delete(id);
    if (session.mode === 'extend' && session.virtualDeviceName && !this.deps.settings().display.keepVirtualDisplays) {
      await detachVirtualDisplay(session.virtualDeviceName).catch(() => {});
    }
    if (!keepError) this.emitUpdate();
    this.emit('native-audio-state', { enabled: this.hasNativeAudio() });
    return { success: true };
  }

  /** The renderer owns the peer connections; after a reload every live session needs a fresh offer. */
  onRendererReloaded(): void {
    this.emit('native-audio-state', { enabled: this.hasNativeAudio() });
    if (![...this.sessions.values()].some((s) => s.agentId)) return;
    setTimeout(() => {
      for (const session of this.sessions.values()) {
        if (!session.agentId || session.stopping) continue;
        this.deps.signaling()?.sendToAgent(session.agentId, { type: 'stream-stop', payload: { reason: 'reconfigure' } });
        this.emitReady(session).catch((error) => this.fail(session, (error as Error).message));
      }
    }, 1500);
  }

  async shutdown(): Promise<void> {
    const attachedDevices = [...this.sessions.values()]
      .filter((s) => s.virtualDeviceName)
      .map((s) => s.virtualDeviceName as string);
    for (const id of [...this.sessions.keys()]) await this.stopInternal(id, true).catch(() => {});
    for (const deviceName of attachedDevices) {
      await detachVirtualDisplay(deviceName).catch(() => {});
    }
  }
}
