// ============================================================
// ScreenFlow — mDNS Network Discovery (Bonjour)
// ============================================================

import { Bonjour, Service } from 'bonjour-service';
import { EventEmitter } from 'events';
import * as os from 'os';
import type { MasterInfo } from '../shared/types';
import { MDNS_SERVICE_TYPE, MDNS_AGENT_TYPE, APP_VERSION } from '../shared/constants';
import {
  patchBonjourService,
  getCleanMdnsHostname,
  getLocalIPv4Addresses,
  ensurePrivateNetworkProfile,
} from './network-utils';

export class NetworkDiscovery extends EventEmitter {
  private bonjourInstances: Bonjour[] = [];
  private publishedServices: Service[] = [];
  private browsers: ReturnType<Bonjour['find']>[] = [];
  private agentBrowsers: ReturnType<Bonjour['find']>[] = [];

  constructor() {
    super();
    patchBonjourService();
    ensurePrivateNetworkProfile();
    this.initBonjour();
  }

  private initBonjour(): void {
    this.destroy();
    const ips = getLocalIPv4Addresses();

    // Bind Bonjour directly to each physical LAN/Wi-Fi IPv4 address
    for (const ip of ips) {
      try {
        const b = new Bonjour({ interface: ip } as any);
        this.bonjourInstances.push(b);
        console.log(`[ScreenFlow] mDNS: Initialized Bonjour on physical LAN interface: ${ip}`);
      } catch (err) {
        console.warn(`[ScreenFlow] Failed to bind Bonjour to interface ${ip}:`, err);
      }
    }

    // Also include a fallback 0.0.0.0 instance
    try {
      this.bonjourInstances.push(new Bonjour());
    } catch {}
  }

  /**
   * Master: Announce this machine as a ScreenFlow master and GameStream (Moonlight) host on the LAN.
   */
  publishMaster(name: string, port: number) {
    try {
      const cleanHost = getCleanMdnsHostname();
      const spaceViewerName = `SpaceViewer - ${cleanHost}`;
      const hostFqdn = `${cleanHost}.local`;

      for (const b of this.bonjourInstances) {
        try {
          // 1. ScreenFlow Master discovery service
          const s1 = b.publish({
            name: `SpaceViewer-${name}`,
            type: MDNS_SERVICE_TYPE,
            port,
            host: hostFqdn,
            txt: {
              version: APP_VERSION,
              os: process.platform,
              capabilities: 'video,audio',
            },
          }) as unknown as Service;
          this.publishedServices.push(s1);

          // 2. Moonlight GameStream primary service (_nvstream._tcp on port 47989)
          const s2 = b.publish({
            name: spaceViewerName,
            type: 'nvstream',
            port: 47989,
            host: hostFqdn,
            txt: {
              version: '7.1.431.0',
              appversion: '7.1.431.0',
              os: process.platform,
            },
          }) as unknown as Service;
          this.publishedServices.push(s2);

          // 3. Moonlight GameStream secondary format (_nvstream._tcp with dash)
          const s3 = b.publish({
            name: `SpaceViewer-${cleanHost}`,
            type: 'nvstream',
            port: 47989,
            host: hostFqdn,
            txt: {
              version: '7.1.431.0',
              appversion: '7.1.431.0',
              os: process.platform,
            },
          }) as unknown as Service;
          this.publishedServices.push(s3);
        } catch (subErr) {
          console.warn('[ScreenFlow] Error publishing master on instance:', subErr);
        }
      }

      console.log(`[ScreenFlow] mDNS: Published GameStream target "${spaceViewerName}" across ${this.bonjourInstances.length} network interfaces`);
    } catch (err) {
      console.error('[ScreenFlow] mDNS publish error:', err);
    }
  }

  /**
   * Agent: Discover ScreenFlow masters on the LAN.
   */
  discoverMasters(callback: (master: MasterInfo) => void): void {
    try {
      for (const b of this.bonjourInstances) {
        try {
          const browser = b.find({ type: MDNS_SERVICE_TYPE });

          browser.on('up', (service: Service) => {
            const master: MasterInfo = {
              name: service.name,
              host: service.host,
              addresses: (service.addresses || []) as string[],
              port: service.port,
              version: service.txt?.version as string,
              os: service.txt?.os as string,
              capabilities: ((service.txt?.capabilities as string) || '').split(','),
            };
            console.log(`[ScreenFlow] mDNS: Discovered master "${master.name}" at ${master.host}:${master.port}`);
            callback(master);
            this.emit('master-found', master);
          });

          browser.on('down', (service: Service) => {
            const master: MasterInfo = {
              name: service.name,
              host: service.host,
              addresses: (service.addresses || []) as string[],
              port: service.port,
              offline: true,
            };
            console.log(`[ScreenFlow] mDNS: Master went offline "${master.name}"`);
            callback(master);
            this.emit('master-lost', master);
          });

          this.browsers.push(browser);
        } catch {}
      }

      console.log('[ScreenFlow] mDNS: Scanning for masters across interfaces...');
    } catch (err) {
      console.error('[ScreenFlow] mDNS discover error:', err);
    }
  }

  /**
   * Agent: Announce this agent on the LAN so Master can discover it.
   */
  publishAgent(name: string, port: number) {
    try {
      const cleanHost = getCleanMdnsHostname();
      const hostFqdn = `${cleanHost}.local`;

      for (const b of this.bonjourInstances) {
        try {
          const s = b.publish({
            name: `SpaceViewerAgent-${name}`,
            type: MDNS_AGENT_TYPE,
            port,
            host: hostFqdn,
            txt: {
              version: APP_VERSION,
              os: process.platform,
            },
          }) as unknown as Service;
          this.publishedServices.push(s);
        } catch {}
      }
      console.log(`[ScreenFlow] mDNS: Published agent "${name}" on port ${port}`);
    } catch (err) {
      console.error('[ScreenFlow] mDNS agent publish error:', err);
    }
  }

  /**
   * Master: Discover ScreenFlow agents on the LAN.
   */
  discoverAgents(callback: (agent: any) => void): void {
    try {
      for (const b of this.bonjourInstances) {
        try {
          const agentBrowser = b.find({ type: MDNS_AGENT_TYPE });

          agentBrowser.on('up', (service: Service) => {
            const agent = {
              name: service.name.replace('SpaceViewerAgent-', ''),
              host: service.host,
              addresses: (service.addresses || []) as string[],
              port: service.port,
              os: (service.txt?.os as string) || 'unknown',
              version: (service.txt?.version as string) || '1.0.0',
            };
            console.log(`[ScreenFlow] mDNS: Discovered agent "${agent.name}" at ${agent.host}:${agent.port}`);
            callback(agent);
          });

          agentBrowser.on('down', (service: Service) => {
            const agent = {
              name: service.name.replace('SpaceViewerAgent-', ''),
              host: service.host,
              addresses: (service.addresses || []) as string[],
              port: service.port,
              offline: true,
            };
            console.log(`[ScreenFlow] mDNS: Agent went offline "${agent.name}"`);
            callback(agent);
          });

          this.agentBrowsers.push(agentBrowser);
        } catch {}
      }

      console.log('[ScreenFlow] mDNS: Scanning for agents across interfaces...');
    } catch (err) {
      console.error('[ScreenFlow] mDNS agent discover error:', err);
    }
  }

  /**
   * Stop all mDNS activity.
   */
  destroy() {
    for (const b of this.bonjourInstances) {
      try {
        b.unpublishAll();
      } catch {}
    }
    this.publishedServices = [];

    for (const br of this.browsers) {
      try {
        br.stop();
      } catch {}
    }
    this.browsers = [];

    for (const abr of this.agentBrowsers) {
      try {
        abr.stop();
      } catch {}
    }
    this.agentBrowsers = [];

    for (const b of this.bonjourInstances) {
      try {
        b.destroy();
      } catch {}
    }
    this.bonjourInstances = [];
  }
}
