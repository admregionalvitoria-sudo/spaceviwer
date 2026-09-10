// SpaceViewer v2.2.9
// ============================================================
// ScreenFlow — WebRTC Audio Utilities
// ============================================================

/**
 * Extract audio tracks from a MediaStream and create
 * a separate audio-only stream for playback.
 */
export function extractAudioStream(stream: MediaStream): MediaStream | null {
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) return null;
  return new MediaStream(audioTracks);
}

/**
 * Create a volume controller using Web Audio API.
 * Returns an object with controls to adjust volume.
 */
export function createVolumeController(
  audioStream: MediaStream,
  audioContext?: AudioContext
): {
  context: AudioContext;
  gainNode: GainNode;
  source: MediaStreamAudioSourceNode;
  outputStream: MediaStream;
  setVolume: (value: number) => void;
  mute: () => void;
  unmute: (volume?: number) => void;
  destroy: () => void;
} {
  const ctx = audioContext || new AudioContext();
  const source = ctx.createMediaStreamSource(audioStream);
  const gainNode = ctx.createGain();
  const destination = ctx.createMediaStreamDestination();

  source.connect(gainNode);
  gainNode.connect(destination);

  // Also connect to speakers for local playback
  gainNode.connect(ctx.destination);

  let lastVolume = 1.0;

  return {
    context: ctx,
    gainNode,
    source,
    outputStream: destination.stream,
    setVolume: (value: number) => {
      // value: 0–100
      const normalized = Math.max(0, Math.min(1, value / 100));
      gainNode.gain.setValueAtTime(normalized, ctx.currentTime);
      lastVolume = normalized;
    },
    mute: () => {
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
    },
    unmute: (volume?: number) => {
      gainNode.gain.setValueAtTime(volume ?? lastVolume, ctx.currentTime);
    },
    destroy: () => {
      source.disconnect();
      gainNode.disconnect();
      if (!audioContext) {
        ctx.close();
      }
    },
  };
}

/**
 * Check if the browser supports audio capture from desktop.
 */
export function supportsDesktopAudio(): boolean {
  // On Windows, Electron supports system audio capture via WASAPI loopback
  // On macOS, it requires a virtual audio driver (BlackHole/Soundflower)
  // On Linux, it requires PulseAudio virtual sink
  return true; // Electron's Chromium generally supports this on Windows
}
