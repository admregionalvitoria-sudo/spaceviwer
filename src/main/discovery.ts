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
  getPrimaryLANIPv4,
  ensurePrivateNetworkProfile,
} from './network-utils';

export class NetworkDiscovery extends EventEmitter {
  private bonjour: Bonjour | null = null;
  private publishedServices: Service[] = [];
  private browser: ReturnType<Bonjour['find']> | null = null;
  private agentBrowser: ReturnType<Bonjour['find']> | null = null;
  private reannounceTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    patchBonjourService();
    ensurePrivateNetworkProfile();
    this.initBonjour();
  }

  private initBonjour(): void {
    this.destroy();
    const primaryIp = getPrimaryLANIPv4();

    try {
      this.bonjour = new Bonjour({ interface: primaryIp, reuseAddr: true } as any);
      console.log(`[SpaceViewer] mDNS: Initialized Bonjour on physical LAN interface: ${primaryIp}`);
    } catch (err) {
      console.warn(`[SpaceViewer] Failed to bind Bonjour to interface ${primaryIp}, falling back to default:`, err);
      this.bonjour = new Bonjour({ reuseAddr: true } as any);
    }
  }

  /**
   * Master: Announce this machine as a ScreenFlow master and GameStream (Moonlight) host on the LAN.
   */
  publishMaster(name: string, port: number) {
    try {
      if (!this.bonjour) {
        this.initBonjour();
      }
      const b = this.bonjour!;
      const cleanHost = getCleanMdnsHostname();
      const hostFqdn = `${cleanHost}.local`;

      // moonlight names: spacedesk - [hostname] as requested by user, plus fallback aliases
      const primarySpacedeskName = `spacedesk - ${cleanHost}`;
      const secondarySpacedeskName = `spacedesk-${cleanHost}`;
      const spaceViewerName = `SpaceViewer - ${cleanHost}`;

      const nvTxt = {
        version: '7.1.431.0',
        appversion: '7.1.431.0',
        os: process.platform,
      };

      // 1. SpaceViewer Master discovery service
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

      // 2. Moonlight GameStream primary service: spacedesk - [hostname] (_nvstream._tcp on port 47989)
      const s2 = b.publish({
        name: primarySpacedeskName,
        type: 'nvstream',
        port: 47989,
        host: hostFqdn,
        txt: nvTxt,
      }) as unknown as Service;
      this.publishedServices.push(s2);

      // 3. Moonlight GameStream secondary format: spacedesk-[hostname]
      const s3 = b.publish({
        name: secondarySpacedeskName,
        type: 'nvstream',
        port: 47989,
        host: hostFqdn,
        txt: nvTxt,
      }) as unknown as Service;
      this.publishedServices.push(s3);

      // 4. Moonlight GameStream debug channel (_nvstream_dbg._tcp on port 47989)
      const s4 = b.publish({
        name: primarySpacedeskName,
        type: 'nvstream_dbg',
        port: 47989,
        host: hostFqdn,
        txt: nvTxt,
      }) as unknown as Service;
      this.publishedServices.push(s4);

      // 5. SpaceViewer fallback aliases
      const s5 = b.publish({
        name: spaceViewerName,
        type: 'nvstream',
        port: 47989,
        host: hostFqdn,
        txt: nvTxt,
      }) as unknown as Service;
      this.publishedServices.push(s5);

      const s6 = b.publish({
        name: cleanHost,
        type: 'nvstream',
        port: 47989,
        host: hostFqdn,
        txt: nvTxt,
      }) as unknown as Service;
      this.publishedServices.push(s6);

      console.log(`[SpaceViewer] mDNS: Published GameStream Moonlight targets "${primarySpacedeskName}", "${spaceViewerName}", "${cleanHost}" on port 47989`);

      // Periodic re-announcement every 10 seconds so Moonlight on the TV discovers the host promptly
      if (this.reannounceTimer) {
        clearInterval(this.reannounceTimer);
      }
      this.reannounceTimer = setInterval(() => {
        try {
          for (const s of this.publishedServices) {
            if (s && typeof (s as any).publish === 'function') {
              (s as any).publish();
            }
          }
        } catch {}
      }, 10000);
    } catch (err) {
      console.error('[SpaceViewer] mDNS publish error:', err);
    }
  }

  /**
   * Agent: Discover ScreenFlow masters on the LAN.
   */
  discoverMasters(callback: (master: MasterInfo) => void): void {
    try {
      if (!this.bonjour) {
        this.initBonjour();
      }
      this.browser = this.bonjour!.find({ type: MDNS_SERVICE_TYPE });

      this.browser.on('up', (service: Service) => {
        const master: MasterInfo = {
          name: service.name,
          host: service.host,
          addresses: (service.addresses || []) as string[],
          port: service.port,
          version: service.txt?.version as string,
          os: service.txt?.os as string,
          capabilities: ((service.txt?.capabilities as string) || '').split(','),
        };
        console.log(`[SpaceViewer] mDNS: Discovered master "${master.name}" at ${master.host}:${master.port}`);
        callback(master);
        this.emit('master-found', master);
      });

      this.browser.on('down', (service: Service) => {
        const master: MasterInfo = {
          name: service.name,
          host: service.host,
          addresses: (service.addresses || []) as string[],
          port: service.port,
          offline: true,
        };
        console.log(`[SpaceViewer] mDNS: Master went offline "${master.name}"`);
        callback(master);
        this.emit('master-lost', master);
      });

      console.log('[SpaceViewer] mDNS: Scanning for masters...');
    } catch (err) {
      console.error('[SpaceViewer] mDNS discover error:', err);
    }
  }

  /**
   * Agent: Announce this agent on the LAN so Master can discover it.
   */
  publishAgent(name: string, port: number) {
    try {
      if (!this.bonjour) {
        this.initBonjour();
      }
      const cleanHost = getCleanMdnsHostname();
      const hostFqdn = `${cleanHost}.local`;

      const s = this.bonjour!.publish({
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
      console.log(`[SpaceViewer] mDNS: Published agent "${name}" on port ${port}`);
    } catch (err) {
      console.error('[SpaceViewer] mDNS agent publish error:', err);
    }
  }

  /**
   * Master: Discover ScreenFlow agents on the LAN.
   */
  discoverAgents(callback: (agent: any) => void): void {
    try {
      if (!this.bonjour) {
        this.initBonjour();
      }
      this.agentBrowser = this.bonjour!.find({ type: MDNS_AGENT_TYPE });

      this.agentBrowser.on('up', (service: Service) => {
        const agent = {
          name: service.name.replace('SpaceViewerAgent-', ''),
          host: service.host,
          addresses: (service.addresses || []) as string[],
          port: service.port,
          os: (service.txt?.os as string) || 'unknown',
          version: (service.txt?.version as string) || '1.0.0',
        };
        console.log(`[SpaceViewer] mDNS: Discovered agent "${agent.name}" at ${agent.host}:${agent.port}`);
        callback(agent);
      });

      this.agentBrowser.on('down', (service: Service) => {
        const agent = {
          name: service.name.replace('SpaceViewerAgent-', ''),
          host: service.host,
          addresses: (service.addresses || []) as string[],
          port: service.port,
          offline: true,
        };
        console.log(`[SpaceViewer] mDNS: Agent went offline "${agent.name}"`);
        callback(agent);
      });

      console.log('[SpaceViewer] mDNS: Scanning for agents...');
    } catch (err) {
      console.error('[SpaceViewer] mDNS agent discover error:', err);
    }
  }

  /**
   * Stop all mDNS activity.
   */
  destroy() {
    if (this.reannounceTimer) {
      clearInterval(this.reannounceTimer);
      this.reannounceTimer = null;
    }
    if (this.bonjour) {
      try {
        this.bonjour.unpublishAll();
        this.bonjour.destroy();
      } catch {}
      this.bonjour = null;
    }
    this.publishedServices = [];
    if (this.browser) {
      try {
        this.browser.stop();
      } catch {}
      this.browser = null;
    }
    if (this.agentBrowser) {
      try {
        this.agentBrowser.stop();
      } catch {}
      this.agentBrowser = null;
    }
  }
}
