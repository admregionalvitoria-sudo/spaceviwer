// ============================================================
// SpaceViewer — native hardware video encoder (FFmpeg)
// Annex-B parsing, encoder probing, and command-line builder
// Contract: docs/ARQUITETURA-TELA-ESTENDIDA.md §3.5
// ============================================================

import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';

export interface BuildArgsOptions {
  encoder: string;
  hmonitor: number | string;
  fps: number;
  bitrateKbps: number;
  width?: number;
  height?: number;
}

export function ffmpegPath(): string | null {
  const packaged = (process as any).resourcesPath
    ? path.join((process as any).resourcesPath, 'ffmpeg', 'ffmpeg.exe')
    : null;
  if (packaged && fs.existsSync(packaged)) return packaged;

  const dev = path.join(process.cwd(), 'resources', 'ffmpeg', 'ffmpeg.exe');
  if (fs.existsSync(dev)) return dev;

  const relative = path.resolve(__dirname, '../../resources/ffmpeg/ffmpeg.exe');
  if (fs.existsSync(relative)) return relative;

  return null;
}

export function supportsIntraRefresh(encoder: string): boolean {
  return encoder === 'h264_nvenc' || encoder === 'h264_qsv';
}

let probedEncodersCache: Promise<string[]> | null = null;

export function clearProbeCache(): void {
  probedEncodersCache = null;
}

export function probeEncoders(): Promise<string[]> {
  if (probedEncodersCache) return probedEncodersCache;
  probedEncodersCache = (async () => {
    const ffmpeg = ffmpegPath();
    if (!ffmpeg) return [];

    const candidates = ['h264_nvenc', 'h264_qsv', 'h264_mf'];
    const working: string[] = [];

    for (const enc of candidates) {
      const args: string[] = ['-hide_banner', '-loglevel', 'error'];
      if (enc === 'h264_nvenc') {
        args.push('-init_hw_device', 'cuda=cu');
      }
      args.push(
        '-f', 'lavfi',
        '-i', 'color=c=black:s=1280x720:r=30',
        '-frames:v', '10',
        '-c:v', enc,
        '-f', 'null',
        '-',
      );

      const ok = await new Promise<boolean>((resolve) => {
        execFile(ffmpeg, args, { windowsHide: true, timeout: 15000 }, (err) => {
          resolve(!err);
        });
      });

      if (ok) {
        working.push(enc);
      }
    }

    return working;
  })();

  return probedEncodersCache;
}

export function buildArgs(opts: BuildArgsOptions): string[] {
  // SPACEVIEWER_TEST_SOURCE=testsrc swaps the screen capture for a synthetic moving pattern
  // (used to test the transport on machines without an active desktop).
  const testSource = process.env.SPACEVIEWER_TEST_SOURCE === 'testsrc';
  let graph = testSource
    ? `testsrc2=s=${opts.width || 1920}x${opts.height || 1080}:r=${opts.fps},realtime,format=bgra`
    : `gfxcapture=hmonitor=${opts.hmonitor}:max_framerate=${opts.fps}:capture_cursor=1`;
  if (!testSource && opts.width && opts.height) {
    graph += `:width=${opts.width}:height=${opts.height}:resize_mode=scale_aspect`;
  }
  if (!testSource) graph += ',hwdownload,format=bgra';
  if (opts.encoder === 'h264_qsv' || opts.encoder === 'h264_mf') {
    graph += ',format=nv12';
  }
  graph += '[v]';

  const args: string[] = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-nostats',
  ];

  if (opts.encoder === 'h264_nvenc') {
    args.push('-init_hw_device', 'cuda=cu');
  }

  if (!testSource) args.push('-init_hw_device', 'd3d11va=dd', '-filter_hw_device', 'dd');
  args.push('-filter_complex', graph, '-map', '[v]');

  const bufsizeKbps = Math.round((opts.bitrateKbps * 2) / opts.fps);

  if (opts.encoder === 'h264_nvenc') {
    args.push(
      '-c:v', 'h264_nvenc',
      '-preset', 'p1',
      '-tune', 'ull',
      '-zerolatency', '1',
      '-delay', '0',
      '-rc', 'cbr',
      '-b:v', `${opts.bitrateKbps}k`,
      '-maxrate', `${opts.bitrateKbps}k`,
      '-bufsize', `${bufsizeKbps}k`,
      '-g', `${opts.fps}`,
      '-bf', '0',
      '-intra-refresh', '1',
      '-profile:v', 'high',
    );
  } else if (opts.encoder === 'h264_qsv') {
    args.push(
      '-c:v', 'h264_qsv',
      '-preset', 'veryfast',
      '-async_depth', '1',
      '-look_ahead', '0',
      '-low_delay_brc', '1',
      '-b:v', `${opts.bitrateKbps}k`,
      '-maxrate', `${opts.bitrateKbps}k`,
      '-bufsize', `${bufsizeKbps}k`,
      '-bf', '0',
      '-g', '600',
      '-int_ref_type', 'vertical',
      '-int_ref_cycle_size', `${opts.fps}`,
      '-profile:v', 'high',
    );
  } else if (opts.encoder === 'h264_mf') {
    args.push(
      '-c:v', 'h264_mf',
      '-hw_encoding', '1',
      '-scenario', 'display_remoting',
      '-rate_control', 'cbr',
      '-b:v', `${opts.bitrateKbps}k`,
      '-bf', '0',
      '-g', `${opts.fps * 2}`,
      '-force_key_frames', 'expr:gte(t,n_forced*2)',
    );
  } else {
    throw new Error(`Unsupported encoder: ${opts.encoder}`);
  }

  args.push(
    '-bsf:v', 'h264_metadata=aud=insert',
    '-flush_packets', '1',
    '-f', 'h264',
    'pipe:1',
  );

  return args;
}

export class AnnexBSplitter {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Array<{ data: Buffer; keyframe: boolean }> {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const results: Array<{ data: Buffer; keyframe: boolean }> = [];

    this.trimToFirstAud();

    while (true) {
      const searchFrom = this.afterFirstAudHeader(this.buffer);
      if (searchFrom === -1) {
        break;
      }
      const nextAud = this.findAud(this.buffer, searchFrom);
      if (nextAud === -1) {
        break;
      }
      const au = this.buffer.subarray(0, nextAud);
      results.push({
        data: au,
        keyframe: this.hasKeyframe(au),
      });
      this.buffer = this.buffer.subarray(nextAud);
    }

    return results;
  }

  flush(): { data: Buffer; keyframe: boolean } | null {
    this.trimToFirstAud();
    if (this.buffer.length === 0) return null;
    const au = this.buffer;
    this.buffer = Buffer.alloc(0);
    return {
      data: au,
      keyframe: this.hasKeyframe(au),
    };
  }

  private trimToFirstAud(): void {
    const firstAud = this.findAud(this.buffer, 0);
    if (firstAud > 0) {
      this.buffer = this.buffer.subarray(firstAud);
    } else if (firstAud === -1) {
      if (this.buffer.length > 4) {
        this.buffer = this.buffer.subarray(this.buffer.length - 4);
      }
    }
  }

  private afterFirstAudHeader(buf: Buffer): number {
    const limit = buf.length - 4;
    for (let i = 0; i <= limit; i++) {
      if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
        if ((buf[i + 3] & 0x1f) === 9) {
          return i + 4;
        }
      }
    }
    return -1;
  }

  private findAud(buf: Buffer, startIndex: number): number {
    const limit = buf.length - 4;
    for (let i = startIndex; i <= limit; i++) {
      if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
        if ((buf[i + 3] & 0x1f) === 9) {
          let start = i;
          while (start > startIndex && buf[start - 1] === 0) {
            start--;
          }
          return start;
        }
      }
    }
    return -1;
  }

  private hasKeyframe(buf: Buffer): boolean {
    const limit = buf.length - 4;
    for (let i = 0; i <= limit; i++) {
      if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
        if ((buf[i + 3] & 0x1f) === 5) {
          return true;
        }
      }
    }
    return false;
  }
}
