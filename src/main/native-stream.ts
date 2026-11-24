// ============================================================
// SpaceViewer — native stream session (FFmpeg + TCP transport)
// Ultra-low latency streaming for Android receivers
// Contract: docs/ARQUITETURA-TELA-ESTENDIDA.md §3.5
// ============================================================

import * as net from 'net';
import { EventEmitter } from 'events';
import { ChildProcess, execFile, spawn } from 'child_process';
import { AnnexBSplitter, buildArgs, ffmpegPath, probeEncoders, supportsIntraRefresh } from './native-encoder';
import { CongestionController } from './congestion-controller';
import { log } from './diagnostics-log';
import { getWindowsDisplayInventory, invalidateDisplayInventory, resourceFile } from './windows-displays';
import { psLiteral, runPowerShell } from './windows-powershell';
import type { DisplayQuality, PcDisplay, ReceiverStats } from '../shared/types';

const TYPE_VIDEO = 1;
const TYPE_AUDIO = 2;
const TYPE_CONFIG = 3;
const TYPE_PING = 4;
const TYPE_PONG = 5;
const TYPE_STATS = 6;
const TYPE_READY = 7;
const TYPE_BYE = 8;

export interface NativeStreamSessionOptions {
  receiverId: string;
  host: string;
  port: number;
  display: PcDisplay;
  quality: DisplayQuality;
  audio: boolean;
  label: string;
  sessionId: string;
}

export function encodeNativeFrame(type: number, flags: number, payload: Buffer): Buffer {
  const header = Buffer.allocUnsafe(12);
  header[0] = 0x53; // 'S'
  header[1] = 0x56; // 'V'
  header[2] = type;
  header[3] = flags;
  header.writeUInt32BE(payload.length, 4);
  header.writeUInt32BE((Date.now() & 0xffffffff) >>> 0, 8);
  return Buffer.concat([header, payload]);
}

export async function resolveHmonitor(deviceName: string): Promise<string | number> {
  if (process.env.SPACEVIEWER_TEST_SOURCE === 'testsrc') return 0;
  const wanted = deviceName.toLowerCase();
  const manager = resourceFile('display-manager.ps1');
  try {
    const raw = await runPowerShell(`& ${psLiteral(manager)} -Action dxgi-outputs\nexit $LASTEXITCODE`, false);
    const parsed: any = raw.trim() ? JSON.parse(raw) : [];
    const outputs: Array<{ deviceName: string; hmonitor: number | string }> = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const match = outputs.find((o) => o.deviceName && o.deviceName.toLowerCase() === wanted);
    if (match?.hmonitor) return match.hmonitor;
  } catch (error) {
    log('native-stream', 'DXGI output lookup failed, using monitor enumeration', { deviceName, error: (error as Error).message });
  }
  // Fallback: the HMONITOR from EnumDisplayMonitors (display-manager query) is equally valid for gfxcapture.
  invalidateDisplayInventory();
  const inventory = await getWindowsDisplayInventory();
  const display = inventory.displays.find((d) => d.deviceName.toLowerCase() === wanted);
  if (display?.hmonitor) return display.hmonitor;
  throw new Error(`O Windows não informou o monitor ${deviceName} para captura.`);
}

export class NativeStreamSession extends EventEmitter {
  readonly receiverId: string;
  readonly host: string;
  readonly port: number;
  display: PcDisplay;
  quality: DisplayQuality;
  audio: boolean;
  label: string;
  sessionId: string;

  private socket: net.Socket | null = null;
  private connected = false;
  private stopped = false;
  private child: ChildProcess | null = null;
  private splitter = new AnnexBSplitter();
  private incomingBuffer = Buffer.alloc(0);

  private hmonitor: string | number = '';
  private activeEncoder = '';
  private decoderName = '';
  private droppedFrames = 0;
  private droppingVideo = false;

  private controller: CongestionController;
  private pingTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private statsLogTimer: NodeJS.Timeout | null = null;
  private restartingEncoder = false;
  private latestStats: ReceiverStats | null = null;
  private rttMs = 0;
  private bytesSentSinceLastStats = 0;
  private lastStatsTime = Date.now();
  private lastPongAt = Date.now();
  private lastVideoDataAt = Date.now();
  private closedEmitted = false;

  constructor(opts: NativeStreamSessionOptions) {
    super();
    this.receiverId = opts.receiverId;
    this.host = opts.host;
    this.port = opts.port;
    this.display = opts.display;
    this.quality = opts.quality;
    this.audio = opts.audio;
    this.label = opts.label;
    this.sessionId = opts.sessionId;

    this.controller = new CongestionController({
      targetKbps: this.quality.bitrateKbps,
    });
  }

  get queueDelayMs(): number {
    return this.controller.queueDelayMs;
  }

  get currentBitrateKbps(): number {
    return this.controller.bitrateKbps;
  }

  get dropped(): number {
    return this.droppedFrames;
  }

  get encoder(): string {
    return this.activeEncoder;
  }

  get decoder(): string {
    return this.decoderName;
  }

  async start(): Promise<void> {
    try {
      this.hmonitor = await resolveHmonitor(this.display.deviceName);
    } catch (err) {
      log('native-stream', 'Failed to resolve hmonitor', { error: (err as Error).message });
      this.emit('fallback', (err as Error).message);
      return;
    }

    const encoders = await probeEncoders();
    if (!encoders || encoders.length === 0) {
      log('native-stream', 'No supported hardware encoder found');
      this.emit('fallback', 'Nenhum codificador de vídeo por hardware suportado.');
      return;
    }
    this.activeEncoder = encoders[0];

    try {
      await this.connectTcp();
    } catch (err) {
      log('native-stream', 'Failed to connect via TCP', { error: (err as Error).message });
      this.emit('fallback', `Falha ao conectar via TCP: ${(err as Error).message}`);
      return;
    }

    this.sendConfig();
    this.startPing();
    this.startTick();
    this.startStatsLog();

    const ok = await this.spawnWithFallback(encoders);
    if (!ok && !this.stopped) {
      // fallback was already emitted in spawnWithFallback
    }
  }

  private startPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.connected && this.socket && !this.socket.destroyed) {
        const payload = Buffer.from(JSON.stringify({ t: Date.now() }), 'utf8');
        this.writeFrame(TYPE_PING, 0, payload);
      }
    }, 200);
  }

  private startTick(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => {
      if (this.connected && !this.stopped) {
        const now = Date.now();
        if (now - this.lastPongAt > 6000) {
          log('native-stream', 'Native stream pong timeout (>6s), closing socket', { receiverId: this.receiverId });
          this.emitClosed(new Error('O aparelho parou de responder.'));
          this.socket?.destroy();
          return;
        }
        if (!this.restartingEncoder && this.child && now - this.lastVideoDataAt > 10000) {
          log('native-stream', 'Encoder stalled (>10s without video data), restarting encoder', { receiverId: this.receiverId });
          this.lastVideoDataAt = now;
          this.restartEncoder(this.controller.bitrateKbps).then((ok) => {
            if (!ok && !this.stopped) {
              this.emitClosed(new Error('O codificador de vídeo travou.'));
              this.socket?.destroy();
            }
          }).catch(() => {});
        }
        const { bitrateKbps, changed } = this.controller.tick();
        if (changed) {
          this.emit('bitrate', { kbps: bitrateKbps, reason: 'congestion' });
          log('congestion', 'Bitrate adjusted by congestion controller', {
            receiverId: this.receiverId,
            kbps: bitrateKbps,
            reason: 'congestion',
            queueDelayMs: Math.round(this.controller.queueDelayMs),
          });
          this.restartEncoder(bitrateKbps).catch((err) => {
            log('native-stream', 'Failed to restart encoder on tick', { error: (err as Error).message });
          });
        }
      }
    }, 1000);
  }

  private startStatsLog(): void {
    if (this.statsLogTimer) clearInterval(this.statsLogTimer);
    this.statsLogTimer = setInterval(() => {
      if (this.connected && !this.stopped) {
        log('stats', 'Session stats', {
          receiverId: this.receiverId,
          fps: this.latestStats?.fps ?? 0,
          decodeMs: this.latestStats?.bufferMs ?? 0,
          rtt: this.rttMs,
          queueDelay: Math.round(this.controller.queueDelayMs),
          bitrate: this.controller.bitrateKbps,
          dropped: this.droppedFrames,
        });
      }
    }, 5000);
  }

  private sendConfig(): void {
    const config = {
      width: this.quality.width,
      height: this.quality.height,
      fps: this.quality.fps,
      audio: this.audio,
      label: this.label,
      sessionId: this.sessionId,
      codec: 'h264',
      intraRefresh: supportsIntraRefresh(this.activeEncoder),
    };
    const payload = Buffer.from(JSON.stringify(config), 'utf8');
    this.writeFrame(TYPE_CONFIG, 0, payload);
  }

  private async connectTcp(): Promise<void> {
    const maxAttempts = 15;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.stopped) return;
      try {
        await new Promise<void>((resolve, reject) => {
          const sock = new net.Socket();
          const onConnect = () => {
            cleanup();
            sock.setNoDelay(true);
            this.socket = sock;
            this.connected = true;
            this.lastPongAt = Date.now();
            this.lastVideoDataAt = Date.now();
            this.setupSocketEvents(sock);
            resolve();
          };
          const onError = (err: Error) => {
            cleanup();
            sock.destroy();
            reject(err);
          };
          const onTimeout = () => {
            cleanup();
            sock.destroy();
            reject(new Error('Tempo limite esgotado'));
          };
          const cleanup = () => {
            sock.removeListener('connect', onConnect);
            sock.removeListener('error', onError);
            sock.removeListener('timeout', onTimeout);
          };
          sock.setTimeout(3000);
          sock.once('connect', onConnect);
          sock.once('error', onError);
          sock.once('timeout', onTimeout);
          sock.connect(this.port, this.host);
        });
        return;
      } catch (err) {
        if (attempt === maxAttempts) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  private setupSocketEvents(sock: net.Socket) {
    sock.on('data', (chunk: Buffer) => this.onSocketData(chunk));
    sock.on('error', (err) => {
      if (!this.closedEmitted) {
        this.closedEmitted = true;
        this.emit('closed', err);
      }
    });
    sock.on('close', () => {
      if (!this.closedEmitted) {
        this.closedEmitted = true;
        this.emit('closed');
      }
    });
  }

  private onSocketData(chunk: Buffer) {
    this.incomingBuffer = Buffer.concat([this.incomingBuffer, chunk]);
    while (this.incomingBuffer.length >= 12) {
      if (this.incomingBuffer[0] !== 0x53 || this.incomingBuffer[1] !== 0x56) {
        this.emitClosed(new Error('Protocol framing error: bad magic bytes'));
        this.socket?.destroy();
        return;
      }
      const type = this.incomingBuffer[2];
      const flags = this.incomingBuffer[3];
      const length = this.incomingBuffer.readUInt32BE(4);
      if (length > 8 * 1024 * 1024) {
        this.emitClosed(new Error('Incoming payload exceeds 8 MiB limit'));
        this.socket?.destroy();
        return;
      }
      if (this.incomingBuffer.length < 12 + length) {
        break;
      }
      const payload = this.incomingBuffer.subarray(12, 12 + length);
      this.incomingBuffer = this.incomingBuffer.subarray(12 + length);
      this.handleIncomingMessage(type, flags, payload);
    }
  }

  private handleIncomingMessage(type: number, _flags: number, payload: Buffer) {
    if (type === TYPE_PONG) {
      this.lastPongAt = Date.now();
      try {
        const parsed = JSON.parse(payload.toString('utf8'));
        if (typeof parsed.t === 'number') {
          this.rttMs = Math.max(0, Date.now() - parsed.t);
          this.controller.onRtt(this.rttMs);
        }
      } catch {}
    } else if (type === TYPE_STATS) {
      try {
        const parsed = JSON.parse(payload.toString('utf8'));
        const now = Date.now();
        const elapsedSec = (now - this.lastStatsTime) / 1000;
        const mbps = elapsedSec > 0 ? (this.bytesSentSinceLastStats * 8) / (elapsedSec * 1e6) : 0;
        this.bytesSentSinceLastStats = 0;
        this.lastStatsTime = now;
        const stats: ReceiverStats = {
          fps: Number(parsed.fps) || 0,
          mbps: Math.round(mbps * 10) / 10,
          rttMs: this.rttMs,
          width: Number(parsed.width) || this.quality.width,
          height: Number(parsed.height) || this.quality.height,
          packetsLost: this.droppedFrames,
          jitterMs: 0,
          bufferMs: Number(parsed.decodeMs) || 0,
          queueMs: Math.round(this.controller.queueDelayMs),
          bitrateKbps: this.controller.bitrateKbps,
        };
        this.latestStats = stats;
        this.emit('stats', stats);
      } catch {}
    } else if (type === TYPE_READY) {
      try {
        const parsed = JSON.parse(payload.toString('utf8'));
        this.decoderName = String(parsed.decoder || 'MediaCodec');
        this.emit('ready', {
          decoder: this.decoderName,
          encoder: this.activeEncoder || 'h264',
        });
      } catch {}
    }
  }

  private emitClosed(err?: Error) {
    if (!this.closedEmitted) {
      this.closedEmitted = true;
      this.emit('closed', err);
    }
  }

  private writeFrame(type: number, flags: number, payload: Buffer): boolean {
    if (!this.socket || this.socket.destroyed || !this.connected) return false;
    const frame = encodeNativeFrame(type, flags, payload);
    this.bytesSentSinceLastStats += frame.length;
    return this.socket.write(frame);
  }

  sendAudio(pcm: Buffer): void {
    if (!this.audio || !this.socket || this.socket.destroyed || !this.connected) return;
    if (this.controller.shouldDropAudio() || this.socket.writableLength > 256 * 1024) {
      return;
    }
    this.writeFrame(TYPE_AUDIO, 0, pcm);
  }

  private handleVideoAu(au: { data: Buffer; keyframe: boolean }) {
    if (!this.socket || this.socket.destroyed || !this.connected) return;

    const bitrateBytesPerFrame = Math.round(
      ((this.controller.bitrateKbps * 1000) / 8) / (this.quality.fps || 60),
    );
    const writable = this.socket.writableLength;
    const wasDropping = this.droppingVideo;
    const shouldDrop = this.controller.shouldDropVideo(writable, bitrateBytesPerFrame);

    if (!wasDropping && shouldDrop) {
      this.droppingVideo = true;
      log('congestion', 'Entered drop mode', {
        receiverId: this.receiverId,
        writable,
        queueDelayMs: Math.round(this.controller.queueDelayMs),
        bitrateKbps: this.controller.bitrateKbps,
      });
    }

    if (this.droppingVideo) {
      if (shouldDrop) {
        this.droppedFrames++;
        this.controller.onFrame(false);
        return;
      }

      if (supportsIntraRefresh(this.activeEncoder)) {
        this.droppingVideo = false;
        log('congestion', 'Left drop mode (intra refresh active)', {
          receiverId: this.receiverId,
          writable,
          queueDelayMs: Math.round(this.controller.queueDelayMs),
        });
      } else {
        if (!au.keyframe) {
          this.droppedFrames++;
          this.controller.onFrame(false);
          return;
        }
        this.droppingVideo = false;
        log('congestion', 'Left drop mode on keyframe (mf)', {
          receiverId: this.receiverId,
          writable,
          queueDelayMs: Math.round(this.controller.queueDelayMs),
        });
      }
    }

    this.controller.onFrame(true);
    this.writeFrame(TYPE_VIDEO, au.keyframe ? 1 : 0, au.data);
  }

  private async spawnWithFallback(encodersList?: string[]): Promise<boolean> {
    const ffmpeg = ffmpegPath();
    if (!ffmpeg) {
      log('native-stream', 'FFmpeg executable not found');
      this.emit('fallback', 'Executável do FFmpeg não encontrado.');
      return false;
    }

    const encoders = encodersList || (await probeEncoders());
    if (!encoders || encoders.length === 0) {
      log('native-stream', 'No supported hardware encoder found');
      this.emit('fallback', 'Nenhum codificador de vídeo por hardware suportado.');
      return false;
    }

    let lastStderrTail = '';

    for (const enc of encoders) {
      if (this.stopped) return false;
      this.activeEncoder = enc;
      log('native-stream', 'Attempting encoder', { encoder: enc, receiverId: this.receiverId });

      const opts = {
        encoder: enc,
        hmonitor: this.hmonitor,
        fps: this.quality.fps,
        bitrateKbps: this.controller.bitrateKbps,
        width: this.display.width !== this.quality.width || this.display.height !== this.quality.height
          ? this.quality.width
          : undefined,
        height: this.display.width !== this.quality.width || this.display.height !== this.quality.height
          ? this.quality.height
          : undefined,
      };

      const args = buildArgs(opts);
      const result = await this.trySpawnEncoder(ffmpeg, args);
      if (result.success) {
        log('native-stream', 'Encoder successfully started', { encoder: enc, receiverId: this.receiverId });
        return true;
      }
      lastStderrTail = result.stderrTail;
      log('native-stream', 'Encoder attempt failed', { encoder: enc, stderrTail: lastStderrTail });
    }

    log('native-stream', 'All encoders failed', { lastStderrTail });
    this.emit('fallback', lastStderrTail || 'Todos os codificadores de vídeo falharam.');
    return false;
  }

  private trySpawnEncoder(ffmpeg: string, args: string[]): Promise<{ success: boolean; stderrTail: string }> {
    return new Promise((resolve) => {
      const child = spawn(ffmpeg, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;

      let receivedVideo = false;
      const stderrLines: string[] = [];
      let idleTimer: NodeJS.Timeout | null = null;

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) {
            stderrLines.push(trimmed);
            if (stderrLines.length > 20) stderrLines.shift();
          }
        }
      });

      // Each FFmpeg process owns its splitter; once a restart replaces this process its
      // remaining output is ignored so two bitstreams never get mixed.
      const ownSplitter = new AnnexBSplitter();
      this.splitter = ownSplitter;
      child.stdout.on('data', (chunk: Buffer) => {
        if (this.child !== child) return;
        receivedVideo = true;
        this.lastVideoDataAt = Date.now();
        const aus = ownSplitter.push(chunk);
        for (const au of aus) {
          this.handleVideoAu(au);
        }
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          idleTimer = null;
          if (this.child !== child) return;
          const flushed = ownSplitter.flush();
          if (flushed) {
            this.handleVideoAu(flushed);
          }
        }, 2);
      });

      let settled = false;

      const exitListener = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (!settled) {
          settled = true;
          this.child = null;
          resolve({ success: false, stderrTail: stderrLines.join('\n') });
        }
      };
      child.once('exit', exitListener);

      setTimeout(() => {
        if (!settled) {
          if (receivedVideo) {
            settled = true;
            child.removeListener('exit', exitListener);
            // A crash after streaming started must not leave the receiver frozen.
            child.once('exit', (code) => {
              if (this.stopped || this.child !== child) return;
              this.child = null;
              log('native-stream', 'Active encoder exited with code', { code, stderrTail: stderrLines.slice(-3).join(' ') });
              this.emitClosed(new Error(`O codificador parou (codigo ${code}). ${stderrLines.slice(-3).join(' ')}`.trim()));
              this.socket?.destroy();
            });
            resolve({ success: true, stderrTail: '' });
          } else {
            settled = true;
            child.removeListener('exit', exitListener);
            this.killProcess(child).then(() => {
              this.child = null;
              resolve({ success: false, stderrTail: stderrLines.join('\n') });
            });
          }
        }
      }, 3000);
    });
  }

  setBudgetKbps(kbps: number): void {
    const previous = this.controller.bitrateKbps;
    const target = Math.min(this.quality.bitrateKbps, kbps);
    this.controller.setTarget(target);
    const current = this.controller.bitrateKbps;
    if (current !== previous) {
      this.emit('bitrate', { kbps: current, reason: 'budget' });
      log('native-stream', 'Bitrate adjusted by budget', {
        receiverId: this.receiverId,
        previousKbps: previous,
        newKbps: current,
        budgetCap: kbps,
      });
      this.restartEncoder(current).catch((err) => {
        log('native-stream', 'Failed to restart encoder on budget change', { error: (err as Error).message });
      });
    }
  }

  async restartEncoder(bitrateKbps: number): Promise<boolean> {
    if (this.stopped || !this.connected) return false;
    if (this.restartingEncoder) return false;
    this.restartingEncoder = true;

    try {
      const ffmpeg = ffmpegPath();
      if (!ffmpeg || !this.activeEncoder) return false;

      const opts = {
        encoder: this.activeEncoder,
        hmonitor: this.hmonitor,
        fps: this.quality.fps,
        bitrateKbps,
        width: this.display.width !== this.quality.width || this.display.height !== this.quality.height
          ? this.quality.width
          : undefined,
        height: this.display.width !== this.quality.width || this.display.height !== this.quality.height
          ? this.quality.height
          : undefined,
      };

      const args = buildArgs(opts);
      const newSplitter = new AnnexBSplitter();

      const success = await new Promise<boolean>((resolve) => {
        const newChild = spawn(ffmpeg, args, {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let switched = false;
        const stderrLines: string[] = [];
        let idleTimer: NodeJS.Timeout | null = null;

        newChild.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (trimmed) {
              stderrLines.push(trimmed);
              if (stderrLines.length > 20) stderrLines.shift();
            }
          }
        });

        const onNewData = (chunk: Buffer) => {
          this.lastVideoDataAt = Date.now();
          const aus = newSplitter.push(chunk);
          if (!switched && aus.length > 0) {
            switched = true;
            const oldChild = this.child;
            this.child = newChild;
            this.splitter = newSplitter;
            if (oldChild) {
              this.killProcess(oldChild).catch(() => {});
            }
            for (const au of aus) {
              this.handleVideoAu(au);
            }
            newChild.once('exit', (code) => {
              if (this.stopped || this.child !== newChild) return;
              this.child = null;
              log('native-stream', 'Encoder process exited', { code, stderrTail: stderrLines.slice(-3).join(' ') });
              this.emitClosed(new Error(`O codificador parou (codigo ${code}). ${stderrLines.slice(-3).join(' ')}`.trim()));
              this.socket?.destroy();
            });
            resolve(true);
          } else if (switched) {
            for (const au of aus) {
              this.handleVideoAu(au);
            }
          }

          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            idleTimer = null;
            const flushed = newSplitter.flush();
            if (flushed && switched) {
              this.handleVideoAu(flushed);
            }
          }, 2);
        };

        newChild.stdout.on('data', onNewData);

        newChild.once('exit', (code) => {
          if (idleTimer) clearTimeout(idleTimer);
          if (!switched) {
            log('native-stream', 'New encoder process exited before first AU', { code, stderrTail: stderrLines.slice(-3).join(' ') });
            resolve(false);
          }
        });

        setTimeout(() => {
          if (!switched) {
            this.killProcess(newChild).catch(() => {});
            resolve(false);
          }
        }, 5000);
      });

      return success;
    } finally {
      this.restartingEncoder = false;
    }
  }

  async reconfigure(quality: DisplayQuality, display: PcDisplay): Promise<void> {
    this.quality = quality;
    this.display = display;
    this.controller.setTarget(this.quality.bitrateKbps);
    this.hmonitor = await resolveHmonitor(this.display.deviceName);

    if (this.child) {
      const old = this.child;
      this.child = null; // detach first so its exit is not reported as a crash
      await this.killProcess(old);
    }
    this.splitter = new AnnexBSplitter();

    this.sendConfig();

    const ffmpeg = ffmpegPath();
    if (!ffmpeg || !this.activeEncoder) return;

    const opts = {
      encoder: this.activeEncoder,
      hmonitor: this.hmonitor,
      fps: this.quality.fps,
      bitrateKbps: this.controller.bitrateKbps,
      width: this.display.width !== this.quality.width || this.display.height !== this.quality.height
        ? this.quality.width
        : undefined,
      height: this.display.width !== this.quality.width || this.display.height !== this.quality.height
        ? this.quality.height
        : undefined,
    };

    const args = buildArgs(opts);
    await this.trySpawnEncoder(ffmpeg, args);
  }

  private async killProcess(child: ChildProcess): Promise<void> {
    if (!child || child.killed || child.exitCode !== null) return;
    try {
      child.kill();
    } catch {}

    await new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | null = setTimeout(() => {
        timer = null;
        if (child.pid && child.exitCode === null) {
          execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
        } else {
          resolve();
        }
      }, 1000);

      child.once('exit', () => {
        if (timer) clearTimeout(timer);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.statsLogTimer) {
      clearInterval(this.statsLogTimer);
      this.statsLogTimer = null;
    }

    try {
      this.writeFrame(TYPE_BYE, 0, Buffer.alloc(0));
    } catch {}

    if (this.socket) {
      try {
        this.socket.end();
      } catch {}
      this.socket = null;
    }

    if (this.child) {
      await this.killProcess(this.child);
      this.child = null;
    }
  }
}
