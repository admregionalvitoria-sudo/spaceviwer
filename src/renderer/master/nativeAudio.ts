// ============================================================
// SpaceViewer — native loopback audio capture (renderer)
// Batches 480 frames (10 ms at 48 kHz stereo Int16) via AudioWorklet
// ============================================================

import { useEffect, useRef } from 'react';

const WORKLET_PROCESSOR_CODE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(960);
    this.count = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;
    const left = input[0];
    const right = input.length > 1 ? input[1] : left;
    const len = left.length;

    for (let i = 0; i < len; i++) {
      let l = left[i];
      let r = right[i];
      if (l > 1) l = 1; else if (l < -1) l = -1;
      if (r > 1) r = 1; else if (r < -1) r = -1;

      this.buffer[this.count * 2] = l < 0 ? (l * 32768) | 0 : (l * 32767) | 0;
      this.buffer[this.count * 2 + 1] = r < 0 ? (r * 32768) | 0 : (r * 32767) | 0;
      this.count++;

      if (this.count === 480) {
        const out = new Int16Array(this.buffer);
        this.port.postMessage(out.buffer, [out.buffer]);
        this.count = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
`;

export function useNativeAudio(): void {
  const activeRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!window.screenflow?.onNativeAudioState) return;

    const startCapture = async () => {
      if (activeRef.current) return;
      activeRef.current = true;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              googEchoCancellation: false,
              googAutoGainControl: false,
              googNoiseSuppression: false,
              googHighpassFilter: false,
            },
          } as any,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              maxWidth: 64,
              maxHeight: 64,
              maxFrameRate: 1,
            },
          } as any,
        });

        if (!activeRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        stream.getVideoTracks().forEach((track) => track.stop());

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContextClass({
          sampleRate: 48000,
          latencyHint: 'interactive',
        });

        const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
        const workletUrl = URL.createObjectURL(blob);
        await audioCtx.audioWorklet.addModule(workletUrl);
        URL.revokeObjectURL(workletUrl);

        if (!activeRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          audioCtx.close().catch(() => {});
          return;
        }

        const source = audioCtx.createMediaStreamSource(stream);
        const workletNode = new AudioWorkletNode(audioCtx, 'pcm-capture-processor');

        workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          if (event.data && window.screenflow?.sendNativeAudio) {
            window.screenflow.sendNativeAudio(event.data);
          }
        };

        source.connect(workletNode);

        const muteGain = audioCtx.createGain();
        muteGain.gain.value = 0;
        workletNode.connect(muteGain);
        muteGain.connect(audioCtx.destination);

        cleanupRef.current = () => {
          try {
            workletNode.disconnect();
            source.disconnect();
            muteGain.disconnect();
          } catch {}
          stream.getTracks().forEach((t) => t.stop());
          audioCtx.close().catch(() => {});
        };
      } catch (err) {
        console.warn('[NativeAudio] Failed to start native audio capture:', err);
        activeRef.current = false;
      }
    };

    const stopCapture = () => {
      activeRef.current = false;
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };

    const off = window.screenflow.onNativeAudioState(({ enabled }) => {
      if (enabled) {
        startCapture();
      } else {
        stopCapture();
      }
    });

    return () => {
      off();
      stopCapture();
    };
  }, []);
}
