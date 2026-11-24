// SpaceViewer v2.2.9
// ============================================================
// ScreenFlow — WebRTC Codec Utilities
// ============================================================

/**
 * Reorder SDP to prefer H.264 codec for maximum compatibility.
 */
export function preferH264(sdp: string): string {
  const isLf = sdp.includes('\r\n') ? false : sdp.includes('\n');
  const delimiter = isLf ? '\n' : '\r\n';
  const lines = sdp.split(delimiter);
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i]);

    if (lines[i].startsWith('m=video')) {
      const parts = lines[i].split(' ');
      if (parts.length > 3) {
        const header = parts.slice(0, 3); // m=video PORT RTP/SAVPF
        const payloadTypes = parts.slice(3);

        const h264PayloadTypes: string[] = [];
        const otherPayloadTypes: string[] = [];

        for (const pt of payloadTypes) {
          const cleanPt = pt.replace(/\r/g, '').trim();
          if (!cleanPt) continue;

          // Look ahead for rtpmap lines that reference this payload type
          const rtpmapLine = lines.find(
            (l) => l.startsWith(`a=rtpmap:${cleanPt}`) && l.toLowerCase().includes('h264')
          );
          if (rtpmapLine) {
            h264PayloadTypes.push(cleanPt);
          } else {
            otherPayloadTypes.push(cleanPt);
          }
        }

        // Reorder: H.264 first, then others
        if (h264PayloadTypes.length > 0) {
          result[result.length - 1] = [...header, ...h264PayloadTypes, ...otherPayloadTypes].join(' ');
        }
      }
    }
  }

  return result.join(delimiter);
}

/**
 * Moves the payload types of `codec` (e.g. "VP9") to the front of the video m-line.
 */
export function preferVideoCodec(sdp: string, codec: string): string {
  if (codec.toUpperCase() === 'H264') return preferH264(sdp);
  const delimiter = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(delimiter);
  const wanted = new Set(
    lines
      .filter((l) => l.startsWith('a=rtpmap:') && l.toUpperCase().includes(` ${codec.toUpperCase()}/`))
      .map((l) => l.slice('a=rtpmap:'.length).split(' ')[0])
  );
  if (wanted.size === 0) return sdp;
  return lines
    .map((line) => {
      if (!line.startsWith('m=video')) return line;
      const parts = line.split(' ');
      const header = parts.slice(0, 3);
      const payloads = parts.slice(3).filter(Boolean);
      return [...header, ...payloads.filter((p) => wanted.has(p)), ...payloads.filter((p) => !wanted.has(p))].join(' ');
    })
    .join(delimiter);
}

/**
 * Adds a video bandwidth line (b=AS) and Chrome's start/min/max bitrate hints to every
 * video codec. Applied to the remote answer so the local encoder ramps up immediately.
 */
export function applyVideoBitrate(sdp: string, kbps: number): string {
  const delimiter = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(delimiter);
  const out: string[] = [];
  let inVideo = false;
  const videoPayloads = new Set<string>();
  for (const line of lines) {
    if (line.startsWith('m=')) {
      inVideo = line.startsWith('m=video');
      if (inVideo) line.split(' ').slice(3).forEach((p) => videoPayloads.add(p.trim()));
    }
    if (inVideo && line.startsWith('b=AS:')) continue;
    if (inVideo && line.startsWith('a=fmtp:')) {
      const pt = line.slice('a=fmtp:'.length).split(' ')[0];
      if (videoPayloads.has(pt) && !line.includes('apt=')) {
        const cleaned = line.replace(/;?x-google-(start|min|max)-bitrate=\d+/g, '');
        out.push(`${cleaned};x-google-start-bitrate=${Math.round(kbps * 0.8)};x-google-min-bitrate=${Math.round(kbps * 0.3)};x-google-max-bitrate=${kbps}`);
        continue;
      }
    }
    out.push(line);
    if (inVideo && line.startsWith('c=')) out.push(`b=AS:${kbps}`);
  }
  return out.join(delimiter);
}

/**
 * Get supported video codecs from the browser.
 */
export async function getSupportedCodecs(): Promise<string[]> {
  const codecs: string[] = [];

  if (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities) {
    const capabilities = RTCRtpSender.getCapabilities('video');
    if (capabilities) {
      const seen = new Set<string>();
      for (const codec of capabilities.codecs) {
        const name = codec.mimeType.split('/')[1]?.toUpperCase();
        if (name && !seen.has(name)) {
          seen.add(name);
          codecs.push(name);
        }
      }
    }
  }

  return codecs.length > 0 ? codecs : ['H264', 'VP8', 'VP9'];
}

/**
 * Sets/merges Opus stereo and high-bitrate parameters in the m=audio section:
 * stereo=1;sprop-stereo=1;maxaveragebitrate=<bitrate*1000>;useinbandfec=1;minptime=10
 */
export function preferOpusStereo(sdp: string, bitrateKbps: number): string {
  const delimiter = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(delimiter);

  const opusPts = new Set<string>();
  let inAudio = false;
  for (const line of lines) {
    if (line.startsWith('m=')) {
      inAudio = line.startsWith('m=audio');
    }
    if (inAudio && line.startsWith('a=rtpmap:')) {
      const match = line.match(/^a=rtpmap:(\d+)\s+opus(\/|$)/i);
      if (match) opusPts.add(match[1]);
    }
  }

  if (opusPts.size === 0) return sdp;

  const targetParams: Record<string, string> = {
    stereo: '1',
    'sprop-stereo': '1',
    maxaveragebitrate: String(bitrateKbps * 1000),
    useinbandfec: '1',
    minptime: '10',
  };

  const handledFmtpPts = new Set<string>();
  const out: string[] = [];
  inAudio = false;

  const flushMissingFmtp = () => {
    if (inAudio) {
      for (const pt of opusPts) {
        if (!handledFmtpPts.has(pt)) {
          const paramsStr = Object.entries(targetParams).map(([k, v]) => `${k}=${v}`).join(';');
          out.push(`a=fmtp:${pt} ${paramsStr}`);
          handledFmtpPts.add(pt);
        }
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('m=')) {
      flushMissingFmtp();
      inAudio = line.startsWith('m=audio');
    }

    if (inAudio && line.startsWith('a=fmtp:')) {
      const match = line.match(/^a=fmtp:(\d+)\s*(.*)$/);
      if (match && opusPts.has(match[1])) {
        const pt = match[1];
        handledFmtpPts.add(pt);
        const existingParamsStr = match[2] || '';
        const entries = existingParamsStr.split(';').map((p) => p.trim()).filter(Boolean);

        const paramMap = new Map<string, string>();
        for (const entry of entries) {
          const eq = entry.indexOf('=');
          if (eq !== -1) {
            paramMap.set(entry.slice(0, eq).trim().toLowerCase(), entry.slice(eq + 1).trim());
          } else {
            paramMap.set(entry.toLowerCase(), '');
          }
        }

        for (const [k, v] of Object.entries(targetParams)) {
          paramMap.set(k.toLowerCase(), v);
        }

        const formatted = Array.from(paramMap.entries())
          .map(([k, v]) => (v ? `${k}=${v}` : k))
          .join(';');
        out.push(`a=fmtp:${pt} ${formatted}`);
        continue;
      }
    }

    out.push(line);
  }

  flushMissingFmtp();

  return out.join(delimiter);
}
