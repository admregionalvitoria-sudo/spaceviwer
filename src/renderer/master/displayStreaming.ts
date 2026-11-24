// ============================================================
// SpaceViewer — streaming engine for Android receivers.
// One desktop capture + one WebRTC peer (initiator) per receiver session.
// Quality rules: docs/ARQUITETURA-TELA-ESTENDIDA.md §4.
// ============================================================

import { useEffect } from 'react';
import { StreamPeer } from '../../shared/webrtc/peer';
import { applyVideoBitrate, preferOpusStereo, preferVideoCodec } from '../../shared/webrtc/codec';
import type { DisplayQuality, DisplaySessionReady, SignalingMessage } from '../../shared/types';
import { useNativeAudio } from './nativeAudio';

interface ActivePeer {
  ready: DisplaySessionReady;
  peer: StreamPeer;
  stream: MediaStream;
}

const DEGRADATION: Record<DisplayQuality['priority'], RTCDegradationPreference> = {
  sharpness: 'maintain-resolution',
  balanced: 'maintain-framerate',
  smoothness: 'maintain-framerate',
};

async function captureDisplay(ready: DisplaySessionReady): Promise<MediaStream> {
  const { width, height, fps } = ready.quality;
  const base = {
    chromeMediaSource: 'desktop',
    chromeMediaSourceId: ready.sourceId,
    maxWidth: width,
    maxHeight: height,
    maxFrameRate: fps,
  };
  // Extended screens are already at the receiver size: also pin the minimum so Chrome never downsizes.
  const attempts = ready.mode === 'extend'
    ? [{ ...base, minWidth: width, minHeight: height, minFrameRate: fps }, base]
    : [base];
  let lastError: unknown;
  let audioFailed = false;

  for (const mandatory of attempts) {
    if (ready.audio?.enabled && !audioFailed) {
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
          video: { mandatory } as any,
        });
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) videoTrack.contentHint = ready.quality.priority === 'sharpness' ? 'detail' : 'motion';
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) audioTrack.contentHint = 'music';
        return stream;
      } catch (err) {
        console.warn('[DisplayStreaming] Audio + video capture failed, falling back to video-only:', err);
        audioFailed = true;
        window.screenflow.reportReceiverNotice(ready.receiverId, 'Não foi possível capturar o som do PC; transmitindo só o vídeo.');
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory } as any });
      const track = stream.getVideoTracks()[0];
      if (track) track.contentHint = ready.quality.priority === 'sharpness' ? 'detail' : 'motion';
      return stream;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Falha ao capturar a tela.');
}

async function applyEncoding(peer: StreamPeer, ready: DisplaySessionReady) {
  const pc = (peer as unknown as { peer?: { _pc?: RTCPeerConnection } }).peer?._pc;
  if (!pc) return;

  const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
  if (videoSender) {
    const parameters = videoSender.getParameters() as RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference };
    if (!parameters.encodings || parameters.encodings.length === 0) parameters.encodings = [{}];
    parameters.encodings[0].maxBitrate = ready.quality.bitrateKbps * 1000;
    parameters.encodings[0].maxFramerate = ready.quality.fps;
    parameters.encodings[0].scaleResolutionDownBy = 1;
    (parameters.encodings[0] as RTCRtpEncodingParameters & { networkPriority?: string; priority?: string }).priority = 'high';
    (parameters.encodings[0] as RTCRtpEncodingParameters & { networkPriority?: string }).networkPriority = 'high';
    parameters.degradationPreference = DEGRADATION[ready.quality.priority];
    try {
      await videoSender.setParameters(parameters);
    } catch (error) {
      // Older engines reject some fields: retry with the essentials only.
      delete parameters.degradationPreference;
      await videoSender.setParameters(parameters).catch(() => console.warn('[DisplayStreaming] setParameters failed:', error));
    }
  }

  const audioSender = pc.getSenders().find((s) => s.track?.kind === 'audio');
  if (audioSender && ready.audio?.enabled) {
    const audioParameters = audioSender.getParameters();
    if (!audioParameters.encodings || audioParameters.encodings.length === 0) audioParameters.encodings = [{}];
    audioParameters.encodings[0].maxBitrate = ready.audio.bitrateKbps * 1000;
    (audioParameters.encodings[0] as RTCRtpEncodingParameters & { networkPriority?: string; priority?: string }).priority = 'high';
    (audioParameters.encodings[0] as RTCRtpEncodingParameters & { networkPriority?: string }).networkPriority = 'high';
    try {
      await audioSender.setParameters(audioParameters);
    } catch (error) {
      console.warn('[DisplayStreaming] audio setParameters failed:', error);
    }
  }
}

class DisplayStreamingEngine {
  private peers = new Map<string, ActivePeer>();
  private starting = new Map<string, number>();
  private sessions = new Map<string, DisplaySessionReady>();
  private recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private recoveryAttempts = new Map<string, { count: number; windowStart: number }>();
  private healthTimers = new Map<string, ReturnType<typeof setInterval>>();

  private clearRecoveryTimer(agentId: string) {
    const t = this.recoveryTimers.get(agentId);
    if (t) {
      clearTimeout(t);
      this.recoveryTimers.delete(agentId);
    }
  }

  private clearHealthTimer(agentId: string) {
    const t = this.healthTimers.get(agentId);
    if (t) {
      clearInterval(t);
      this.healthTimers.delete(agentId);
    }
  }

  private scheduleRecovery(ready: DisplaySessionReady, reason: string) {
    if (this.sessions.get(ready.agentId)?.sessionId !== ready.sessionId) return;
    if (this.recoveryTimers.has(ready.agentId)) return;

    const now = Date.now();
    const prev = this.recoveryAttempts.get(ready.agentId);
    const tracker = prev && now - prev.windowStart < 45000
      ? { count: prev.count + 1, windowStart: prev.windowStart }
      : { count: 1, windowStart: now };
    this.recoveryAttempts.set(ready.agentId, tracker);

    if (tracker.count > 6) {
      this.stop(ready.agentId);
      window.screenflow.reportReceiverStatus(ready.receiverId, 'error', reason);
      return;
    }

    const delayMs = Math.min(5000, tracker.count * 1000);
    console.warn(`[DisplayStreaming] Scheduling WebRTC recovery for ${ready.agentId} (#${tracker.count}) in ${delayMs}ms: ${reason}`);
    this.stop(ready.agentId);
    const timer = setTimeout(() => {
      this.recoveryTimers.delete(ready.agentId);
      const current = this.sessions.get(ready.agentId);
      if (current && current.sessionId === ready.sessionId) {
        this.start(current).catch(console.error);
      }
    }, delayMs);
    this.recoveryTimers.set(ready.agentId, timer);
  }

  async start(ready: DisplaySessionReady) {
    this.clearRecoveryTimer(ready.agentId);
    this.sessions.set(ready.agentId, ready);
    const token = Date.now() + Math.random();
    this.starting.set(ready.agentId, token);
    this.stop(ready.agentId);
    let stream: MediaStream;
    try {
      stream = await captureDisplay(ready);
    } catch (error) {
      if (this.sessions.get(ready.agentId)?.sessionId === ready.sessionId) {
        this.scheduleRecovery(ready, `Não foi possível capturar a tela: ${(error as Error).message}`);
      }
      return;
    }
    // A newer session-ready/ended arrived while capturing.
    if (this.starting.get(ready.agentId) !== token || this.sessions.get(ready.agentId)?.sessionId !== ready.sessionId) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const { codec, bitrateKbps } = ready.quality;
    const peer = new StreamPeer({
      isInitiator: true,
      stream,
      sdpTransform: (sdp) =>
        preferOpusStereo(
          applyVideoBitrate(preferVideoCodec(sdp, codec), bitrateKbps),
          ready.audio.bitrateKbps,
        ),
      onSignal: (data) => {
        const type = (data as { type?: string }).type === 'offer' ? 'webrtc-offer' : 'ice-candidate';
        window.screenflow.sendMessageToAgent(ready.agentId, JSON.stringify({ type, targetId: ready.agentId, payload: data }));
      },
      onConnect: () => {
        this.recoveryAttempts.delete(ready.agentId);
        applyEncoding(peer, ready).catch(() => {});
        window.screenflow.reportReceiverStatus(ready.receiverId, 'streaming');
      },
      onClose: () => {
        if (this.peers.get(ready.agentId)?.peer === peer) {
          this.scheduleRecovery(ready, 'Conexão de vídeo encerrada.');
        }
      },
      onError: (error) => {
        if (this.peers.get(ready.agentId)?.peer !== peer) return;
        this.scheduleRecovery(ready, `Conexão de vídeo falhou: ${error.message}`);
      },
    });
    this.peers.set(ready.agentId, { ready, peer, stream });
    // Monitor ICE/connection health so prolonged disconnects recover automatically without user action.
    let disconnectedSince = 0;
    const healthTimer = setInterval(() => {
      if (this.peers.get(ready.agentId)?.peer !== peer) {
        this.clearHealthTimer(ready.agentId);
        return;
      }
      const pc = (peer as unknown as { peer?: { _pc?: RTCPeerConnection } }).peer?._pc;
      if (!pc) return;
      const state = pc.connectionState || pc.iceConnectionState;
      const ice = pc.iceConnectionState;
      if (state === 'failed' || ice === 'failed') {
        this.scheduleRecovery(ready, 'Falha na conexão WebRTC.');
      } else if (state === 'disconnected' || ice === 'disconnected') {
        if (!disconnectedSince) disconnectedSince = Date.now();
        else if (Date.now() - disconnectedSince > 4000) {
          this.scheduleRecovery(ready, 'Conexão WebRTC instável.');
        }
      } else {
        disconnectedSince = 0;
      }
    }, 2000);
    this.healthTimers.set(ready.agentId, healthTimer);

    // Encoding limits also apply before 'connect' fires (media can flow before the data channel opens).
    setTimeout(() => applyEncoding(peer, ready).catch(() => {}), 1500);
    // If the capture ends (monitor removed / DWM reset), try recovering before marking an error.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (this.peers.get(ready.agentId)?.peer !== peer) return;
      this.scheduleRecovery(ready, 'A tela capturada deixou de existir.');
    });
  }

  signal(msg: SignalingMessage) {
    if (!msg.fromId) return;
    const active = this.peers.get(msg.fromId);
    if (!active) return;
    if (msg.type === 'webrtc-answer') {
      const answer = msg.payload as { type: 'answer'; sdp: string };
      const sdp = preferOpusStereo(
        applyVideoBitrate(answer.sdp, active.ready.quality.bitrateKbps),
        active.ready.audio.bitrateKbps,
      );
      active.peer.signal({ ...answer, sdp } as any);
    } else if (msg.type === 'ice-candidate') {
      active.peer.signal(msg.payload as any);
    }
  }

  stop(agentId: string) {
    this.clearHealthTimer(agentId);
    const active = this.peers.get(agentId);
    if (!active) return;
    this.peers.delete(agentId);
    try { active.peer.destroy(); } catch { /* ignore */ }
    active.stream.getTracks().forEach((t) => t.stop());
  }

  stopAll() {
    this.starting.clear();
    this.sessions.clear();
    this.recoveryAttempts.clear();
    for (const id of [...this.recoveryTimers.keys()]) this.clearRecoveryTimer(id);
    for (const id of [...this.peers.keys()]) this.stop(id);
  }

  invalidate(agentId: string) {
    this.starting.delete(agentId);
    this.sessions.delete(agentId);
    this.recoveryAttempts.delete(agentId);
    this.clearRecoveryTimer(agentId);
    this.stop(agentId);
  }
}

/** Mount once (MasterApp): keeps receiver streams alive regardless of the visible tab. */
export function useDisplayStreaming() {
  useNativeAudio();

  useEffect(() => {
    const engine = new DisplayStreamingEngine();
    const offReady = window.screenflow.onDisplaySessionReady((ready) => { engine.start(ready).catch(console.error); });
    const offEnded = window.screenflow.onDisplaySessionEnded((info) => engine.invalidate(info.agentId));
    const offSignal = window.screenflow.onSignalingMessage((msg) => engine.signal(msg));
    return () => {
      offReady();
      offEnded();
      offSignal();
      engine.stopAll();
    };
  }, []);
}
