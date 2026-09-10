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
