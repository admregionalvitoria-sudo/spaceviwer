// SpaceViewer v2.2.9
import * as http from 'http';
import * as os from 'os';
import { networkInterfaces } from 'os';
import { EventEmitter } from 'events';
import { GAMESTREAM_PORT, GAMESTREAM_UNIQUE_ID } from '../shared/constants';
import type { GameStreamStatus } from '../shared/types';

export class GameStreamServer extends EventEmitter {
  private server: http.Server | null = null;
  private status: GameStreamStatus = 'stopped';

  constructor() {
    super();
  }

  getStatus(): GameStreamStatus {
    return this.status;
  }

  start(): Promise<boolean> {
    if (this.server) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        console.log(`[GameStreamServer] Request: ${req.method} ${url.pathname}`);

        if (url.pathname === '/serverinfo') {
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          const xml = this.generateServerInfoXml();
          res.end(xml);
        } else if (url.pathname === '/pair') {
          // Moonlight pairing phase
          // Return simple paired response so Moonlight doesn't freeze or fail
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          res.end(this.generatePairXml());
        } else if (url.pathname === '/applist') {
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          res.end(this.generateAppListXml());
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      });

      this.server.listen(GAMESTREAM_PORT, () => {
        this.status = 'running';
        this.emit('status-change', 'running');
        console.log(`[GameStreamServer] Running on port ${GAMESTREAM_PORT}`);
        resolve(true);
      });

      this.server.on('error', (err) => {
        console.error('[GameStreamServer] Error:', err);
        this.status = 'error';
        this.emit('status-change', 'error');
        resolve(false);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          this.status = 'stopped';
          this.emit('status-change', 'stopped');
          console.log('[GameStreamServer] Stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private getMacAddress(): string {
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      for (const info of iface) {
        if (!info.internal && info.mac && info.mac !== '00:00:00:00:00:00') {
          return info.mac.toUpperCase();
        }
      }
    }
    return '00:11:22:33:44:55';
  }

  private getLocalIp(): string {
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      for (const info of iface) {
        if (info.family === 'IPv4' && !info.internal) {
          return info.address;
        }
      }
    }
    return '127.0.0.1';
  }

  private generateServerInfoXml(): string {
    const hostname = os.hostname();
    const mac = this.getMacAddress();
    const ip = this.getLocalIp();

    return `<?xml version="1.0" encoding="utf-8"?>
<root status_code="200">
  <page>serverinfo</page>
  <Status>200</Status>
  <StatusMsg>OK</StatusMsg>
  <appversion>7.1.431.0</appversion>
  <protocol_version>7</protocol_version>
  <paircount>0</paircount>
  <paired>1</paired>
  <state>sunshine_state</state>
  <mac>${mac}</mac>
  <hostname>spacedesk - ${hostname}</hostname>
  <uniqueid>${GAMESTREAM_UNIQUE_ID}</uniqueid>
  <ServerIP>${ip}</ServerIP>
  <ExternalIP>${ip}</ExternalIP>
  <GpuType>1</GpuType>
  <localisconnected>1</localisconnected>
  <SupportedDisplayMode>
    <DisplayMode>
      <Width>1920</Width>
      <Height>1080</Height>
      <RefreshRate>60</RefreshRate>
    </DisplayMode>
  </SupportedDisplayMode>
</root>`;
  }

  private generatePairXml(): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<root status_code="200">
  <paired>1</paired>
  <Status>200</Status>
</root>`;
  }

  private generateAppListXml(): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<root status_code="200">
  <AppList>
    <App>
      <AppTitle>SpaceViewer Desktop</AppTitle>
      <ID>1</ID>
      <IsGame>0</IsGame>
    </App>
  </AppList>
</root>`;
  }
}
