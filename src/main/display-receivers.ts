// ============================================================
// SpaceViewer — discovery and control of Android receivers (SpaceViewer Display APK)
// Protocol: docs/ARQUITETURA-TELA-ESTENDIDA.md §3.1 / §3.2 / §3.5
// ============================================================

import * as dgram from 'dgram';
import * as http from 'http';
import * as os from 'os';
import { EventEmitter } from 'events';
import type { Bonjour } from 'bonjour-service';
import type { DeviceInfo, ReceiverOrientation, ReceiverMode, DisplayTransport } from '../shared/types';
import {
  RECEIVER_ANNOUNCE_PORT,
  RECEIVER_CONTROL_PORT,
  RECEIVER_DISCOVERY_PORT,
  RECEIVER_DISCOVERY_PROBE,
  RECEIVER_EXPIRY_MS,
  RECEIVER_MDNS_TYPE,
  RECEIVER_STREAM_PORT,
} from '../shared/constants';

export interface DiscoveredDevice extends DeviceInfo {
  lastSeen: number;
  source: 'udp' | 'mdns' | 'manual';
}

export interface ReceiverPorts {
  discovery: number;
  announce: number;
  /** Overrides the control port announced by the device (tests). */
  control?: number;
}

export interface ConnectRequest {
  host: string;
  port: number;
  masterName: string;
  sessionId: string;
  mode: ReceiverMode;
  label: string;
  orientation: ReceiverOrientation;
  transport?: DisplayTransport;
  streamPort?: number;
}

type BonjourFactory = () => Bonjour | null;

/** Parses a DeviceInfo datagram/body; returns null for anything that is not a SpaceViewer Display. */
export function parseDeviceInfo(raw: string | Buffer, fallbackIp?: string): DeviceInfo | null {
  let data: any;
  try { data = JSON.parse(raw.toString()); } catch { return null; }
  if (!data || data.type !== 'spaceviewer-display' || typeof data.id !== 'string' || !data.id) return null;
  const width = Number(data.width) || 1920;
  const height = Number(data.height) || 1080;
  return {
    type: 'spaceviewer-display',
    protocol: Number(data.protocol) || 1,
    id: data.id,
    name: String(data.name || data.model || 'Android'),
    model: String(data.model || ''),
    manufacturer: String(data.manufacturer || ''),
    android: String(data.android || ''),
    appVersion: String(data.appVersion || ''),
    ip: String(data.ip || fallbackIp || ''),
    ips: Array.isArray(data.ips) ? data.ips.map(String) : undefined,
    controlPort: Number(data.controlPort) || RECEIVER_CONTROL_PORT,
    streamPort: Number(data.streamPort) || RECEIVER_STREAM_PORT,
    capabilities: Array.isArray(data.capabilities) ? data.capabilities.map(String) : [],
    width: Math.max(width, height),
    height: Math.min(width, height),
    refreshRate: Number(data.refreshRate) || 60,
    density: Number(data.density) || 1,
    orientation: data.orientation === 'portrait' || data.orientation === 'auto' ? data.orientation : 'landscape',
    state: data.state === 'connecting' || data.state === 'streaming' ? data.state : 'idle',
    connectedTo: data.connectedTo ? String(data.connectedTo) : null,
  };
}

/** Directed broadcast address of every active IPv4 interface, plus the limited broadcast. */
export function broadcastAddresses(): string[] {
  const targets = new Set<string>(['255.255.255.255']);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal || !entry.netmask) continue;
      const ip = entry.address.split('.').map(Number);
      const mask = entry.netmask.split('.').map(Number);
      if (ip.length !== 4 || mask.length !== 4) continue;
      targets.add(ip.map((part, i) => (part | (~mask[i] & 255)) & 255).join('.'));
    }
  }
  return [...targets];
}

function requestJson(method: 'GET' | 'POST', host: string, port: number, path: string, body?: unknown, timeoutMs = 4000): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host, port, path, method, timeout: timeoutMs,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : undefined,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let data: any = null;
        try { data = JSON.parse(raw); } catch { /* keep raw */ }
        if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300) resolve(data);
        else reject(new Error(data?.error || `O aparelho respondeu ${res.statusCode}.`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('O aparelho não respondeu a tempo. Confira se o app está aberto e na mesma rede.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export class DisplayReceivers extends EventEmitter {
  private devices = new Map<string, DiscoveredDevice>();
  private announceSocket: dgram.Socket | null = null;
  private probeSocket: dgram.Socket | null = null;
  private bonjour: Bonjour | null = null;
  private browser: { stop(): void } | null = null;
  private expiryTimer: NodeJS.Timeout | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  private running = false;
  /** Devices kept in the list even after their announcements stop (active sessions). */
  readonly pinned = new Set<string>();

  constructor(private ports: ReceiverPorts = { discovery: RECEIVER_DISCOVERY_PORT, announce: RECEIVER_ANNOUNCE_PORT }, private bonjourFactory?: BonjourFactory) {
    super();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.announceSocket = this.bindSocket(this.ports.announce, 'announce');
    this.probeSocket = this.bindSocket(0, 'probe');
    try {
      this.bonjour = this.bonjourFactory?.() ?? null;
      const browser = this.bonjour?.find({ type: RECEIVER_MDNS_TYPE });
      browser?.on('up', (service: any) => {
        const ip = ((service.addresses || []) as string[]).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || service.referer?.address;
        if (ip) this.addManual(ip, service.port, 'mdns').catch(() => {});
      });
      this.browser = browser ?? null;
    } catch (error) {
      console.warn('[Receivers] mDNS browse unavailable:', (error as Error).message);
    }
    this.expiryTimer = setInterval(() => this.expire(), 2000);
    this.scan().catch(() => {});
  }

  stop(): void {
    this.running = false;
    for (const socket of [this.announceSocket, this.probeSocket]) {
      try { socket?.close(); } catch { /* already closed */ }
    }
    this.announceSocket = this.probeSocket = null;
    try { this.browser?.stop(); } catch { /* ignore */ }
    try { this.bonjour?.destroy(); } catch { /* ignore */ }
    this.browser = null;
    this.bonjour = null;
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.expiryTimer = this.emitTimer = null;
  }

  private bindSocket(port: number, role: string): dgram.Socket | null {
    try {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socket.on('error', (error) => console.warn(`[Receivers] UDP ${role} error:`, error.message));
      socket.on('message', (msg, rinfo) => this.onDatagram(msg, rinfo.address, 'udp'));
      socket.bind(port, () => {
        try { socket.setBroadcast(true); } catch { /* ignore */ }
      });
      return socket;
    } catch (error) {
      console.warn(`[Receivers] Could not open UDP ${role} socket:`, (error as Error).message);
      return null;
    }
  }

  private onDatagram(msg: Buffer, address: string, source: DiscoveredDevice['source']) {
    const info = parseDeviceInfo(msg, address);
    if (!info) return;
    // Reply sender address is authoritative (the device may report a stale IP).
    this.upsert({ ...info, ip: address || info.ip }, source);
  }

  private upsert(info: DeviceInfo, source: DiscoveredDevice['source']) {
    const previous = this.devices.get(info.id);
    const next: DiscoveredDevice = { ...info, lastSeen: Date.now(), source: previous?.source === 'manual' ? 'manual' : source };
    this.devices.set(info.id, next);
    const changed = !previous || previous.ip !== next.ip || previous.state !== next.state || previous.connectedTo !== next.connectedTo ||
      previous.name !== next.name || previous.width !== next.width || previous.height !== next.height || Date.now() - previous.lastSeen > RECEIVER_EXPIRY_MS;
    if (changed) this.scheduleEmit();
  }

  private expire() {
    let changed = false;
    for (const [id, device] of this.devices) {
      if (Date.now() - device.lastSeen > RECEIVER_EXPIRY_MS * 6 && !this.pinned.has(id)) {
        this.devices.delete(id);
        changed = true;
      } else if (Date.now() - device.lastSeen > RECEIVER_EXPIRY_MS && Date.now() - device.lastSeen < RECEIVER_EXPIRY_MS + 2500) {
        changed = true; // crossed the "offline" threshold
      }
    }
    if (changed) this.scheduleEmit();
  }

  private scheduleEmit() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit('updated', this.list());
    }, 100);
  }

  isOnline(id: string): boolean {
    const device = this.devices.get(id);
    return Boolean(device && Date.now() - device.lastSeen <= RECEIVER_EXPIRY_MS);
  }

  /** Online devices plus pinned (in-session) ones. */
  list(): DiscoveredDevice[] {
    return [...this.devices.values()]
      .filter((d) => this.isOnline(d.id) || this.pinned.has(d.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): DiscoveredDevice | undefined {
    return this.devices.get(id);
  }

  /** Broadcasts the discovery probe and resolves with the list after replies settle. */
  async scan(waitMs = 1200): Promise<DiscoveredDevice[]> {
    const socket = this.probeSocket;
    if (socket) {
      const probe = Buffer.from(RECEIVER_DISCOVERY_PROBE, 'ascii');
      for (const target of broadcastAddresses()) {
        socket.send(probe, this.ports.discovery, target, (error) => {
          if (error) console.warn(`[Receivers] probe to ${target} failed:`, error.message);
        });
      }
      // Refresh devices we already know directly (broadcast can be filtered by some routers).
      for (const device of this.devices.values()) {
        if (device.ip) socket.send(probe, this.ports.discovery, device.ip, () => {});
      }
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return this.list();
  }

  async addManual(ip: string, port?: number, source: DiscoveredDevice['source'] = 'manual'): Promise<DiscoveredDevice> {
    const host = ip.trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) throw new Error('Digite um IPv4 válido, por exemplo 192.168.0.42.');
    const data = await requestJson('GET', host, this.ports.control ?? port ?? RECEIVER_CONTROL_PORT, '/info');
    const info = parseDeviceInfo(JSON.stringify(data), host);
    if (!info) throw new Error('Este endereço não é um SpaceViewer Display.');
    this.upsert({ ...info, ip: host }, source);
    return this.devices.get(info.id)!;
  }

  private target(id: string) {
    const device = this.devices.get(id);
    if (!device) throw new Error('Aparelho não encontrado. Clique em Buscar novamente.');
    return { host: device.ip, port: this.ports.control ?? device.controlPort ?? RECEIVER_CONTROL_PORT };
  }

  async connect(id: string, request: ConnectRequest): Promise<void> {
    const { host, port } = this.target(id);
    await requestJson('POST', host, port, '/connect', request, 5000);
  }

  async disconnect(id: string): Promise<void> {
    const { host, port } = this.target(id);
    await requestJson('POST', host, port, '/disconnect', {}, 3000);
  }
}
