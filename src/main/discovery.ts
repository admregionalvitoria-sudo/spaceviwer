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
  private bonjour: Bonjour;
  private publishedService: Service | null = null;
  private browser: ReturnType<Bonjour['find']> | null = null;

  private publishedMoonlightService: Service | null = null;
  private publishedSenaiService: Service | null = null;

  constructor() {
    super();
    patchBonjourService();
    ensurePrivateNetworkProfile();
    this.bonjour = new Bonjour();
  }

  /**
   * Master: Announce this machine as a ScreenFlow master on the LAN.
   */
  publishMaster(name: string, port: number) {
    try {
      this.publishedService = this.bonjour.publish({
        name: `SpaceViewer-${name}`,
        type: MDNS_SERVICE_TYPE,
        port,
        txt: {
          version: APP_VERSION,
          os: process.platform,
          capabilities: 'video,audio',
        },
      }) as unknown as Service;
      console.log(`[ScreenFlow] mDNS: Published master "${name}" on port ${port}`);

      // Publish Moonlight GameStream target with SpaceViewer prefix and PC hostname
      const cleanHost = getCleanMdnsHostname();
      const spaceViewerName = `SpaceViewer - ${cleanHost}`;

      this.publishedMoonlightService = this.bonjour.publish({
        name: spaceViewerName,
        type: 'nvstream',
        port: 47989,
        txt: {
          version: '7.1.431.0',
          os: process.platform,
        },
      }) as unknown as Service;
      console.log(`[ScreenFlow] mDNS: Published GameStream target "${spaceViewerName}" on port 47989`);

      // Also publish secondary formats so Moonlight on any TV/OS finds the host effortlessly
      this.publishedSenaiService = this.bonjour.publish({
        name: `SpaceViewer-${cleanHost}`,
        type: 'nvstream',
        port: 47989,
        txt: {
          version: '7.1.431.0',
          os: process.platform,
        },
      }) as unknown as Service;
      console.log(`[ScreenFlow] mDNS: Published secondary GameStream target "SpaceViewer-${cleanHost}" on port 47989`);
    } catch (err) {
      console.error('[ScreenFlow] mDNS publish error:', err);
    }
  }

  /**
   * Agent: Discover ScreenFlow masters on the LAN.
   */
  discoverMasters(callback: (master: MasterInfo) => void): void {
    try {
      this.browser = this.bonjour.find({ type: MDNS_SERVICE_TYPE });

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
        console.log(`[ScreenFlow] mDNS: Discovered master "${master.name}" at ${master.host}:${master.port}`);
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
        console.log(`[ScreenFlow] mDNS: Master went offline "${master.name}"`);
        callback(master);
        this.emit('master-lost', master);
      });

      console.log('[ScreenFlow] mDNS: Scanning for masters...');
    } catch (err) {
      console.error('[ScreenFlow] mDNS discover error:', err);
    }
  }

  private publishedAgentService: Service | null = null;
  private agentBrowser: ReturnType<Bonjour['find']> | null = null;

  /**
   * Agent: Announce this agent on the LAN so Master can discover it.
   */
  publishAgent(name: string, port: number) {
    try {
      this.publishedAgentService = this.bonjour.publish({
        name: `SpaceViewerAgent-${name}`,
        type: MDNS_AGENT_TYPE,
        port,
        txt: {
          version: APP_VERSION,
          os: process.platform,
        },
      }) as unknown as Service;
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
      this.agentBrowser = this.bonjour.find({ type: MDNS_AGENT_TYPE });

      this.agentBrowser.on('up', (service: Service) => {
        const agent = {
          name: service.name.replace('SpaceViewerAgent-', ''),
          host: service.host,
          addresses: (service.addresses || []) as string[],
          port: service.port,
          os: service.txt?.os as string || 'unknown',
          version: service.txt?.version as string || '1.0.0',
        };
        console.log(`[ScreenFlow] mDNS: Discovered agent "${agent.name}" at ${agent.host}:${agent.port}`);
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
        console.log(`[ScreenFlow] mDNS: Agent went offline "${agent.name}"`);
        callback(agent);
      });

      console.log('[ScreenFlow] mDNS: Scanning for agents...');
    } catch (err) {
      console.error('[ScreenFlow] mDNS agent discover error:', err);
    }
  }

  /**
   * Stop all mDNS activity.
   */
  destroy() {
    if (this.publishedService || this.publishedMoonlightService || this.publishedSenaiService || this.publishedAgentService) {
      try {
        this.bonjour.unpublishAll();
      } catch {
        // ignore
      }
      this.publishedService = null;
      this.publishedMoonlightService = null;
      this.publishedSenaiService = null;
      this.publishedAgentService = null;
    }
    if (this.browser) {
      try {
        this.browser.stop();
      } catch {
        // ignore
      }
      this.browser = null;
    }
    if (this.agentBrowser) {
      try {
        this.agentBrowser.stop();
      } catch {
        // ignore
      }
      this.agentBrowser = null;
    }
    try {
      this.bonjour.destroy();
    } catch {
      // ignore
    }
  }
}
