// SpaceViewer v2.2.9
// ============================================================
// ScreenFlow — WebRTC Peer Connection Manager
// ============================================================

import SimplePeer from 'simple-peer';
import { preferH264 } from './codec';
import { ICE_SERVERS } from '../constants';

export interface PeerOptions {
  stream?: MediaStream;
  isInitiator: boolean;
  onSignal: (data: SimplePeer.SignalData) => void;
  onStream?: (stream: MediaStream) => void;
  onConnect?: () => void;
  onClose?: () => void;
  onError?: (err: Error) => void;
  onData?: (data: Uint8Array) => void;
}

export interface EncodingParams {
  bitrate: number; // Kbps
  fps: number;
  scale: number;
}

export class StreamPeer {
  private peer: SimplePeer.Instance;
  private _connected = false;
  private _destroyed = false;

  constructor(options: PeerOptions) {
    this.peer = new SimplePeer({
      initiator: options.isInitiator,
      stream: options.stream,
      trickle: true,
      config: {
        iceServers: ICE_SERVERS,
      },
      sdpTransform: (sdp: string) => {
        return preferH264(sdp);
      },
    });

    this.peer.on('signal', (data) => {
      options.onSignal(data);
    });

    this.peer.on('stream', (stream) => {
      options.onStream?.(stream);
    });

    this.peer.on('connect', () => {
      this._connected = true;
      console.log('[StreamPeer] Connected');
      options.onConnect?.();
    });

    this.peer.on('close', () => {
      this._connected = false;
      console.log('[StreamPeer] Closed');
      options.onClose?.();
    });

    this.peer.on('error', (err) => {
      console.error('[StreamPeer] Error:', err);
      options.onError?.(err);
    });

    this.peer.on('data', (data) => {
      options.onData?.(data);
    });
  }

  get connected(): boolean {
    return this._connected;
  }

  get destroyed(): boolean {
    return this._destroyed;
  }

  /**
   * Feed signaling data (offer/answer/ICE candidate) from the remote peer.
   */
  signal(data: SimplePeer.SignalData) {
    if (!this._destroyed) {
      this.peer.signal(data);
    }
  }

  /**
   * Adjust encoding parameters (bitrate, FPS, scale) on the fly.
   */
  async setEncodingParameters(params: EncodingParams): Promise<void> {
    try {
      // Access the underlying RTCPeerConnection
      const pc = (this.peer as unknown as { _pc: RTCPeerConnection })._pc;
      if (!pc) return;

      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (!sender) return;

      const parameters = sender.getParameters();
      if (!parameters.encodings || parameters.encodings.length === 0) {
        parameters.encodings = [{}];
      }

      parameters.encodings[0].maxBitrate = params.bitrate * 1000; // Kbps → bps
      parameters.encodings[0].maxFramerate = params.fps;
      if (params.scale > 1) {
        parameters.encodings[0].scaleResolutionDownBy = params.scale;
      }

      await sender.setParameters(parameters);
      console.log('[StreamPeer] Encoding params updated:', params);
    } catch (err) {
      console.error('[StreamPeer] Failed to set encoding parameters:', err);
    }
  }

  /**
   * Replace the video track on the existing connection.
   */
  replaceTrack(
    oldTrack: MediaStreamTrack,
    newTrack: MediaStreamTrack,
    stream: MediaStream
  ) {
    try {
      // simple-peer exposes replaceTrack in newer versions
      (this.peer as unknown as { replaceTrack: Function }).replaceTrack(
        oldTrack,
        newTrack,
        stream
      );
    } catch {
      // Fallback: use the underlying RTCPeerConnection
      const pc = (this.peer as unknown as { _pc: RTCPeerConnection })._pc;
      if (pc) {
        const sender = pc.getSenders().find((s) => s.track === oldTrack);
        sender?.replaceTrack(newTrack);
      }
    }
  }

  /**
   * Send arbitrary data over the data channel.
   */
  send(data: string | Uint8Array) {
    if (this._connected && !this._destroyed) {
      this.peer.send(data);
    }
  }

  /**
   * Get WebRTC connection statistics.
   */
  async getStats(): Promise<{
    latency: number;
    fps: number;
    bandwidth: number;
    packetsLost: number;
    jitter: number;
  } | null> {
    try {
      const pc = (this.peer as unknown as { _pc: RTCPeerConnection })._pc;
      if (!pc) return null;

      const stats = await pc.getStats();
      let latency = 0;
      let fps = 0;
      let bandwidth = 0;
      let packetsLost = 0;
      let jitter = 0;

      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          latency = report.currentRoundTripTime
            ? report.currentRoundTripTime * 1000
            : 0;
        }
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          fps = report.framesPerSecond || 0;
          bandwidth = report.bytesSent
            ? (report.bytesSent * 8) / 1000000
            : 0;
        }
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          fps = report.framesPerSecond || 0;
          packetsLost = report.packetsLost || 0;
          jitter = report.jitter ? report.jitter * 1000 : 0;
        }
      });

      return { latency, fps, bandwidth, packetsLost, jitter };
    } catch {
      return null;
    }
  }

  /**
   * Destroy the peer connection.
   */
  destroy() {
    if (!this._destroyed) {
      this._destroyed = true;
      this._connected = false;
      this.peer.destroy();
    }
  }
}
