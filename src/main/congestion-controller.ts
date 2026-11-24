// ============================================================
// SpaceViewer — Real-time network congestion controller
// Tracks queue delay via PONG RTT EWMA and adapts video bitrate
// Contract: docs/ARQUITETURA-TELA-ESTENDIDA.md §3.5
// ============================================================

export interface CongestionControllerOptions {
  targetKbps: number;
  minKbps?: number; // default 1500
  now?: () => number;
}

export class CongestionController {
  private targetKbps: number;
  private readonly minKbps: number;
  private readonly now: () => number;
  private currentKbps: number;

  private srtt: number | null = null;
  private rttSamples: Array<{ rtt: number; time: number }> = [];
  private frameSamples: Array<{ sent: boolean; time: number }> = [];
  private dropIntervals: Array<{ start: number; end: number | null }> = [];
  private dropping: boolean = false;

  private lastChangeTime: number;
  private lastDropTime: number;
  private lastHighDelayTime: number;

  constructor(opts: CongestionControllerOptions) {
    this.targetKbps = opts.targetKbps;
    this.minKbps = opts.minKbps ?? 1500;
    this.now = opts.now ?? (() => Date.now());

    this.currentKbps = Math.min(this.targetKbps, Math.max(this.minKbps, this.targetKbps));
    const t0 = this.now();
    this.lastChangeTime = t0;
    this.lastDropTime = t0;
    this.lastHighDelayTime = t0;
  }

  get bitrateKbps(): number {
    return this.currentKbps;
  }

  onRtt(rttMs: number): void {
    const currentTime = this.now();
    if (this.srtt === null) {
      this.srtt = rttMs;
    } else {
      this.srtt = 0.75 * this.srtt + 0.25 * rttMs;
    }

    this.rttSamples.push({ rtt: rttMs, time: currentTime });
    const cutoff = currentTime - 10000;
    while (this.rttSamples.length > 0 && this.rttSamples[0].time < cutoff) {
      this.rttSamples.shift();
    }

    if (this.queueDelayMs >= 30) {
      this.lastHighDelayTime = currentTime;
    }
  }

  onFrame(sent: boolean): void {
    const currentTime = this.now();
    this.frameSamples.push({ sent, time: currentTime });
    if (!sent) {
      this.lastDropTime = currentTime;
    }
    const cutoff = currentTime - 2000;
    while (this.frameSamples.length > 0 && this.frameSamples[0].time < cutoff) {
      this.frameSamples.shift();
    }
  }

  private get baseRtt(): number {
    if (this.rttSamples.length === 0) {
      return this.srtt ?? 0;
    }
    let min = this.rttSamples[0].rtt;
    for (let i = 1; i < this.rttSamples.length; i++) {
      if (this.rttSamples[i].rtt < min) {
        min = this.rttSamples[i].rtt;
      }
    }
    return min;
  }

  get queueDelayMs(): number {
    if (this.srtt === null) return 0;
    return Math.max(0, this.srtt - this.baseRtt);
  }

  shouldDropVideo(writableBytes: number, frameBytesEstimate: number): boolean {
    const currentTime = this.now();
    const queueDelay = this.queueDelayMs;

    if (queueDelay >= 30) {
      this.lastHighDelayTime = currentTime;
    }

    if (!this.dropping) {
      // Node always holds the last write or two (and audio chunks) for a moment: only a real
      // backlog (several frames, at least 64 KiB) means the link is saturated.
      if (queueDelay > 80 || writableBytes > Math.max(64 * 1024, 4 * frameBytesEstimate)) {
        this.dropping = true;
        this.dropIntervals.push({ start: currentTime, end: null });
      }
    } else {
      if (queueDelay < 30 && writableBytes < 16 * 1024) {
        this.dropping = false;
        const last = this.dropIntervals[this.dropIntervals.length - 1];
        if (last && last.end === null) {
          last.end = currentTime;
        }
      }
    }

    return this.dropping;
  }

  shouldDropAudio(): boolean {
    return this.queueDelayMs > 300;
  }

  setTarget(kbps: number): void {
    this.targetKbps = kbps;
    if (this.currentKbps > this.targetKbps) {
      this.currentKbps = this.targetKbps;
      this.lastChangeTime = this.now();
    }
  }

  private getDropDurationInLast2s(currentTime: number): number {
    const windowStart = currentTime - 2000;
    const windowEnd = currentTime;
    let totalMs = 0;

    while (this.dropIntervals.length > 0) {
      const first = this.dropIntervals[0];
      if (first.end !== null && first.end < windowStart) {
        this.dropIntervals.shift();
      } else {
        break;
      }
    }

    for (const interval of this.dropIntervals) {
      const start = Math.max(windowStart, interval.start);
      const end = Math.min(windowEnd, interval.end ?? currentTime);
      if (end > start) {
        totalMs += (end - start);
      }
    }

    return totalMs;
  }

  tick(): { bitrateKbps: number; changed: boolean } {
    const currentTime = this.now();
    const timeSinceLastChange = currentTime - this.lastChangeTime;

    const cutoff2s = currentTime - 2000;
    while (this.frameSamples.length > 0 && this.frameSamples[0].time < cutoff2s) {
      this.frameSamples.shift();
    }

    const totalFrames2s = this.frameSamples.length;
    let droppedFrames2s = 0;
    for (const f of this.frameSamples) {
      if (!f.sent) droppedFrames2s++;
    }

    const dropRatio2s = totalFrames2s > 0 ? droppedFrames2s / totalFrames2s : 0;
    const dropDuration2s = this.getDropDurationInLast2s(currentTime);
    const dropDurationRatio2s = dropDuration2s / 2000;

    // DOWN: if (dropped/total in last 2 s > 5% OR dropping for > 20% of the last 2 s) and >= 4 s since the last change
    //       → current = max(min, round(current * 0.7))
    if ((dropRatio2s > 0.05 || dropDurationRatio2s > 0.20) && timeSinceLastChange >= 4000) {
      const nextKbps = Math.max(this.minKbps, Math.round(this.currentKbps * 0.7));
      if (nextKbps !== this.currentKbps) {
        this.currentKbps = nextKbps;
        this.lastChangeTime = currentTime;
        this.lastDropTime = currentTime;
        this.lastHighDelayTime = currentTime;
        return { bitrateKbps: this.currentKbps, changed: true };
      }
      this.lastChangeTime = currentTime;
      return { bitrateKbps: this.currentKbps, changed: false };
    }

    // UP: if no drops and queueDelay < 30 ms for the last 20 s and current < target → current = min(target, round(current * 1.15))
    if (this.queueDelayMs >= 30) {
      this.lastHighDelayTime = currentTime;
    }
    const cleanDrops = (currentTime - this.lastDropTime) >= 20000;
    const cleanDelay = (currentTime - this.lastHighDelayTime) >= 20000;

    if (cleanDrops && cleanDelay && this.currentKbps < this.targetKbps) {
      const nextKbps = Math.min(this.targetKbps, Math.round(this.currentKbps * 1.15));
      if (nextKbps !== this.currentKbps) {
        this.currentKbps = nextKbps;
        this.lastChangeTime = currentTime;
        this.lastDropTime = currentTime;
        this.lastHighDelayTime = currentTime;
        return { bitrateKbps: this.currentKbps, changed: true };
      }
    }

    return { bitrateKbps: this.currentKbps, changed: false };
  }
}
