// SpaceViewer v2.2.9
// ============================================================
// ScreenFlow — WebSocket Signaling Server
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, Server } from 'http';
import { networkInterfaces } from 'os';
import { EventEmitter } from 'events';
import type { SignalingMessage, AgentConnection } from '../shared/types';
import { PING_INTERVAL } from '../shared/constants';
import { getLocalIPv4Addresses } from './network-utils';

export class SignalingServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private httpServer: Server | null = null;
  private agents: Map<string, AgentConnection> = new Map();
  private port: number;
  private pingTimer: NodeJS.Timeout | null = null;
  private _isRunning = false;

  constructor(port = 7523) {
    super();
    this.port = port;
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
        this.httpServer = createServer();
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
    const connection: AgentConnection = {
      id,
      ws,
      ip,
      connectedAt: Date.now(),
      authenticated: false, // Wait for authorization by default
    };

    this.agents.set(id, connection);
    console.log(`[ScreenFlow] Agent connected: ${id} from ${ip}`);

    // Send agent its ID and pending authorization status
    this.sendToAgent(id, {
      type: 'auth-response',
      payload: { agentId: id, status: 'pending' },
    });

    ws.on('message', (data: Buffer) => {
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
    });
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
    for (const [id, agent] of this.agents) {
      if (id !== excludeId) {
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
    return Array.from(this.agents.values()).map((a) => ({
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
            ws.ping();
          } else {
            this.agents.delete(id);
            this.emit('agent-disconnected', id);
          }
        } catch {
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
