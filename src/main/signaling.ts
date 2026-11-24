// SpaceViewer v2.2.9
// ============================================================
// ScreenFlow — WebSocket Signaling Server
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import * as fs from 'fs';
import { networkInterfaces } from 'os';
import { EventEmitter } from 'events';
import type { SignalingMessage, AgentConnection } from '../shared/types';
import { PING_INTERVAL } from '../shared/constants';
import { getLocalIPv4Addresses } from './network-utils';

export interface SignalingOptions {
  /** Decides whether a display (APK) WebSocket carries a session this PC requested. */
  isExpectedDisplay?: (sessionId: string, deviceId: string) => boolean;
  /** Absolute path of the receiver APK served at GET /apk (null when not bundled). */
  apkPath?: () => string | null;
}

interface DisplayConnection {
  deviceId: string;
  sessionId: string;
}

export class SignalingServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private httpServer: Server | null = null;
  private agents: Map<string, AgentConnection> = new Map();
  private port: number;
  private pingTimer: NodeJS.Timeout | null = null;
  private _isRunning = false;
  private displays: Map<string, DisplayConnection> = new Map();
  private missedPongs: Map<string, number> = new Map();
  private options: SignalingOptions;

  constructor(port = 7523, options: SignalingOptions = {}) {
    super();
    this.port = port;
    this.options = options;
  }

  get listeningPort(): number {
    return this.port;
  }

  /** Serves the receiver APK so phones can install it straight from the PC. */
  private handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = (req.url || '/').split('?')[0];
    if (req.method === 'GET' && (url === '/apk' || url === '/SpaceViewerDisplay.apk')) {
      const file = this.options.apkPath?.() ?? null;
      if (!file || !fs.existsSync(file)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'APK não incluído nesta instalação.' }));
        return;
      }
      const size = fs.statSync(file).size;
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': size,
        'Content-Disposition': 'attachment; filename="SpaceViewerDisplay.apk"',
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (req.headers.upgrade) return; // WebSocket upgrades are handled by ws.
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('SpaceViewer');
  }

  isDisplay(agentId: string): boolean {
    return this.displays.has(agentId);
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  get connectedAgents(): Map<string, AgentConnection> {
    return this.agents;
  }

  async start(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      try {
        this.httpServer = createServer((req, res) => this.handleHttp(req, res));
        this.wss = new WebSocketServer({ server: this.httpServer });

        this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
          const agentId = crypto.randomUUID();
          this.handleAgentConnection(agentId, ws, req);
        });

        this.wss.on('error', (err) => {
          console.error('WebSocket Server error:', err);
          this.emit('error', err);
        });

        this.httpServer.listen(this.port, () => {
          this._isRunning = true;
          console.log(`[ScreenFlow] Signaling server running on port ${this.port}`);
          this.startPingLoop();
          resolve(this.getLocalAddresses());
        });

        this.httpServer.on('error', (err) => {
          console.error('HTTP Server error:', err);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async stop(): Promise<void> {
    this._isRunning = false;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    // Close all agent connections
    for (const [id, agent] of this.agents) {
      try {
        (agent.ws as WebSocket).close(1000, 'Server shutting down');
      } catch {
        // ignore
      }
    }
    this.agents.clear();
    this.missedPongs.clear();

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          if (this.httpServer) {
            this.httpServer.close(() => resolve());
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  private handleAgentConnection(id: string, ws: WebSocket, req: IncomingMessage) {
    const ip = req.socket.remoteAddress || 'unknown';
    const query = new URLSearchParams((req.url || '').split('?')[1] || '');
    if (query.get('role') === 'display') {
      this.handleDisplayConnection(id, ws, ip, query.get('deviceId') || '', query.get('sessionId') || '');
      return;
    }
    const connection: AgentConnection = {
      id,
      ws,
      ip,
      connectedAt: Date.now(),
      authenticated: false, // Wait for authorization by default
    };

    this.agents.set(id, connection);
    this.missedPongs.set(id, 0);
    console.log(`[ScreenFlow] Agent connected: ${id} from ${ip}`);

    // Send agent its ID and pending authorization status
    this.sendToAgent(id, {
      type: 'auth-response',
      payload: { agentId: id, status: 'pending' },
    });

    ws.on('pong', () => {
      this.missedPongs.set(id, 0);
    });

    ws.on('message', (data: Buffer) => {
      this.missedPongs.set(id, 0);
      try {
        const msg: SignalingMessage = JSON.parse(data.toString());
        this.routeMessage(id, msg);
      } catch (err) {
        console.error('Failed to parse message from agent', id, err);
      }
    });

    ws.on('close', () => {
      console.log(`[ScreenFlow] Agent disconnected: ${id}`);
      this.agents.delete(id);
      this.missedPongs.delete(id);
      this.emit('agent-disconnected', id);
    });

    ws.on('error', (err) => {
      console.error(`[ScreenFlow] Agent ${id} WebSocket error:`, err);
    });

    this.emit('agent-connected', {
      id,
      ip,
      connectedAt: connection.connectedAt,
      name: `Agent-${id.slice(0, 6)}`,
      status: 'pending',
      authenticated: false,
      metrics: {
        latency: 0,
        fps: 0,
        bandwidth: 0,
        packetsLost: 0,
        jitter: 0,
        decodingTime: 0,
      },
    });
  }

  /**
   * Android receivers (SpaceViewer Display) are accepted only for sessions this PC asked for
   * via POST /connect, and never appear in the PC-agent list.
   */
  private handleDisplayConnection(id: string, ws: WebSocket, ip: string, deviceId: string, sessionId: string) {
    const expected = Boolean(deviceId && sessionId && this.options.isExpectedDisplay?.(sessionId, deviceId));
    if (!expected) {
      console.warn(`[ScreenFlow] Rejected unexpected display connection from ${ip}`);
      try { ws.close(4001, 'Unexpected session'); } catch { /* ignore */ }
      return;
    }
    this.agents.set(id, { id, ws, ip, connectedAt: Date.now(), authenticated: true, os: 'android' });
    this.displays.set(id, { deviceId, sessionId });
    this.missedPongs.set(id, 0);
    this.sendToAgent(id, { type: 'auth-response', payload: { agentId: id, status: 'ok' } });

    ws.on('pong', () => {
      this.missedPongs.set(id, 0);
    });

    ws.on('message', (data: Buffer) => {
      this.missedPongs.set(id, 0);
      let msg: SignalingMessage | { type: string; payload: unknown };
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'ping') {
        this.sendToAgent(id, { type: 'pong', payload: Date.now() });
        return;
      }
      this.emit('display-message', { agentId: id, deviceId, sessionId, type: msg.type, payload: msg.payload });
    });

    ws.on('close', () => {
      this.missedPongs.delete(id);
      if (!this.displays.has(id)) return;
      this.agents.delete(id);
      this.displays.delete(id);
      this.emit('display-disconnected', { agentId: id, deviceId, sessionId });
    });

    ws.on('error', (err) => console.error(`[ScreenFlow] Display ${id} WebSocket error:`, err.message));

    console.log(`[ScreenFlow] Display receiver ${deviceId} connected from ${ip} (session ${sessionId})`);
    this.emit('display-connected', { agentId: id, deviceId, sessionId, ip });
  }

  private routeMessage(fromId: string, msg: SignalingMessage) {
    switch (msg.type) {
      case 'webrtc-offer':
      case 'webrtc-answer':
      case 'ice-candidate':
        // Forward to the target agent or broadcast to master renderer
        if (msg.targetId) {
          this.sendToAgent(msg.targetId, { ...msg, fromId });
        } else {
          // Forward to master renderer via event
          this.emit('signaling-message', { ...msg, fromId });
        }
        break;

      case 'agent-info':
        this.updateAgentInfo(fromId, msg.payload);
        break;

      case 'ping':
        this.sendToAgent(fromId, { type: 'pong', payload: Date.now() });
        break;

      default:
        this.emit('signaling-message', { ...msg, fromId });
        break;
    }
  }

  private updateAgentInfo(agentId: string, info: unknown) {
    const agent = this.agents.get(agentId);
    if (agent && typeof info === 'object' && info !== null) {
      const data = info as Record<string, unknown>;
      if (data.name) agent.name = data.name as string;
      if (data.os) agent.os = data.os as string;
      this.emit('agent-updated', {
        id: agentId,
        status: agent.authenticated ? 'connected' : 'pending',
        authenticated: agent.authenticated,
        ...data,
      });
    }
  }

  sendToAgent(agentId: string, msg: SignalingMessage | object) {
    const agent = this.agents.get(agentId);
    if (agent) {
      try {
        const ws = agent.ws as WebSocket;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      } catch (err) {
        console.error(`Failed to send to agent ${agentId}:`, err);
      }
    }
  }

  broadcast(msg: SignalingMessage | object, excludeId?: string) {
    for (const [id] of this.agents) {
      // PC-agent broadcasts (stream-start/stop) must not reach Android receivers.
      if (id !== excludeId && !this.displays.has(id)) {
        this.sendToAgent(id, msg);
      }
    }
  }

  pauseAll() {
    this.broadcast({ type: 'stream-stop', payload: { reason: 'paused' } });
  }

  disconnectAgentById(agentId: string) {
    const agent = this.agents.get(agentId);
    if (agent) {
      try {
        (agent.ws as WebSocket).close(1000, 'Disconnected by master');
      } catch {
        // ignore
      }
      this.agents.delete(agentId);
      this.missedPongs.delete(agentId);
      this.emit('agent-disconnected', agentId);
    }
  }

  acceptAgent(agentId: string) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.authenticated = true;
      console.log(`[ScreenFlow] Agent ${agentId} accepted by master.`);

      // Notify the agent
      this.sendToAgent(agentId, {
        type: 'auth-response',
        payload: { agentId, status: 'ok' },
      });

      // Emit update so master store / renderer refreshes
      this.emit('agent-updated', {
        id: agentId,
        authenticated: true,
        status: 'connected',
      });
    }
  }

  getAgentsList() {
    return Array.from(this.agents.values()).filter((a) => !this.displays.has(a.id)).map((a) => ({
      id: a.id,
      ip: a.ip,
      connectedAt: a.connectedAt,
      name: a.name || `Agent-${a.id.slice(0, 6)}`,
      os: a.os || 'unknown',
      authenticated: a.authenticated,
      status: a.authenticated ? 'connected' : 'pending',
    }));
  }

  private startPingLoop() {
    this.pingTimer = setInterval(() => {
      for (const [id, agent] of this.agents) {
        try {
          const ws = agent.ws as WebSocket;
          if (ws.readyState === WebSocket.OPEN) {
            const missed = this.missedPongs.get(id) ?? 0;
            if (missed >= 3) {
              console.warn(`[ScreenFlow] Terminating unresponsive WebSocket ${id}`);
              this.missedPongs.delete(id);
              try { ws.terminate(); } catch { /* ignore */ }
              continue;
            }
            this.missedPongs.set(id, missed + 1);
            ws.ping();
          } else {
            this.missedPongs.delete(id);
            this.agents.delete(id);
            this.emit('agent-disconnected', id);
          }
        } catch {
          this.missedPongs.delete(id);
          this.agents.delete(id);
          this.emit('agent-disconnected', id);
        }
      }
    }, PING_INTERVAL);
  }

  getLocalAddresses(): string[] {
    return getLocalIPv4Addresses();
  }
}
