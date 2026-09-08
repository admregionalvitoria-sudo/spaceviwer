// ============================================================
// SpaceViewer — Smart TV & Moonlight Discovery Engine
// Discovers Smart TVs (LG, Samsung, Android TV, Apple TV, Roku, Fire TV)
// and Moonlight instances on the local network via SSDP, mDNS & Sunshine API.
// ============================================================

import * as dgram from 'dgram';
import * as http from 'http';
import { EventEmitter } from 'events';
import { Bonjour, Service } from 'bonjour-service';
import type { SmartTVDevice, MoonlightClient } from '../shared/types';
import { getMoonlightClients, getStreamStats } from './gamestream-host';
import {
  patchBonjourService,
  getLocalIPv4Addresses,
  ensurePrivateNetworkProfile,
} from './network-utils';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;

export class TVDiscovery extends EventEmitter {
  private bonjour: Bonjour | null = null;
  private udpSocket: dgram.Socket | null = null;
  private devices = new Map<string, SmartTVDevice>();
  private browsers: any[] = [];
  private scanInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  public start() {
    patchBonjourService();
    ensurePrivateNetworkProfile();
    this.initBonjour();
    this.initSSDP();
    this.triggerScan();

    // Periodic background scan every 30s
    this.scanInterval = setInterval(() => {
      this.triggerScan();
    }, 30000);
  }

  public stop() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }

    if (this.udpSocket) {
      try {
        this.udpSocket.close();
      } catch {}
      this.udpSocket = null;
    }

    if (this.browsers.length > 0) {
      this.browsers.forEach((b) => {
        try {
          b.stop();
        } catch {}
      });
      this.browsers = [];
    }

    if (this.bonjour) {
      try {
        this.bonjour.destroy();
      } catch {}
      this.bonjour = null;
    }
  }

  public async getDiscoveredTVs(): Promise<SmartTVDevice[]> {
    await this.correlateWithSunshineClients();
    return Array.from(this.devices.values());
  }

  public triggerScan() {
    this.sendSSDPMSearch();
    this.correlateWithSunshineClients().catch(() => {});
  }

  // ------------------------------------------------------------
  // Bonjour / mDNS Discovery
  // ------------------------------------------------------------
  private initBonjour() {
    try {
      this.bonjour = new Bonjour();

      const serviceTypes = [
        '_googlecast._tcp',
        '_airplay._tcp',
        '_nvstream._tcp',
        '_moonlight._tcp',
        '_androidtv-remote._tcp',
        '_dial-multiscreen._tcp',
        '_webos-second-screen._tcp',
        '_lge-device._tcp',
        '_samsungmsf._tcp',
      ];

      serviceTypes.forEach((type) => {
        try {
          const browser = this.bonjour!.find({ type });
          browser.on('up', (service: Service) => this.handleBonjourService(service, type));
          this.browsers.push(browser);
        } catch (err) {
          console.warn(`[TVDiscovery] Error binding mDNS type ${type}:`, err);
        }
      });
    } catch (err) {
      console.error('[TVDiscovery] Failed to init Bonjour:', err);
    }
  }

  private handleBonjourService(service: Service, serviceType: string) {
    const ip = (service.addresses && service.addresses.length > 0) ? service.addresses[0] : service.host;
    if (!ip || ip.startsWith('127.') || ip === '::1') return;

    const rawName = service.name || service.host || 'Smart TV / Dispositivo';
    const cleanName = rawName.replace(/^[0-9a-fA-F-]+@/, '').replace(/\._[a-z0-9_-]+$/, '');
    
    let brand: SmartTVDevice['brand'] = 'generic';
    let type: SmartTVDevice['type'] = 'tv';

    const lowerName = cleanName.toLowerCase();
    const lowerType = serviceType.toLowerCase();

    if (lowerName.includes('lg') || lowerType.includes('webos') || lowerType.includes('lge')) {
      brand = 'lg';
    } else if (lowerName.includes('samsung') || lowerType.includes('samsung')) {
      brand = 'samsung';
    } else if (lowerName.includes('apple') || lowerName.includes('apple tv') || lowerType.includes('airplay')) {
      brand = 'appletv';
      type = 'streaming_box';
    } else if (lowerName.includes('roku')) {
      brand = 'roku';
      type = 'streaming_box';
    } else if (lowerName.includes('fire') || lowerName.includes('amazon')) {
      brand = 'firetv';
      type = 'streaming_box';
    } else if (lowerType.includes('googlecast') || lowerType.includes('androidtv') || lowerName.includes('bravia') || lowerName.includes('tcl') || lowerName.includes('philips') || lowerName.includes('chromecast')) {
      brand = 'androidtv';
    } else if (lowerType.includes('moonlight') || lowerType.includes('nvstream') || lowerName.includes('moonlight')) {
      brand = 'moonlight';
      type = 'moonlight_app';
    }

    const deviceId = `mdns-${ip}-${brand}`;
    const existing = this.devices.get(deviceId) || this.findByIp(ip);

    const device: SmartTVDevice = {
      id: existing ? existing.id : deviceId,
      name: existing ? (existing.name.length > cleanName.length ? existing.name : cleanName) : cleanName,
      ip,
      brand: existing ? (existing.brand !== 'generic' ? existing.brand : brand) : brand,
      model: service.txt?.md || service.txt?.model || existing?.model || undefined,
      status: existing?.status || 'online',
      isMoonlightPaired: existing?.isMoonlightPaired || false,
      clientUuid: existing?.clientUuid,
      type: existing ? existing.type : type,
      lastSeen: Date.now(),
    };

    this.devices.set(device.id, device);
    this.notifyUpdate();
  }

  // ------------------------------------------------------------
  // SSDP / UPnP Discovery
  // ------------------------------------------------------------
  private initSSDP() {
    try {
      this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.udpSocket.on('error', (err) => {
        console.warn('[TVDiscovery] UDP socket error:', err);
      });

      this.udpSocket.on('message', (msg, rinfo) => {
        this.parseSSDPResponse(msg.toString(), rinfo.address);
      });

      this.udpSocket.bind(() => {
        const lanIps = getLocalIPv4Addresses();
        for (const ip of lanIps) {
          try {
            this.udpSocket?.addMembership(SSDP_ADDRESS, ip);
            console.log(`[TVDiscovery] Joined SSDP multicast group on LAN IP: ${ip}`);
          } catch (err: any) {
            console.warn(`[TVDiscovery] Failed to add SSDP membership on ${ip}:`, err?.message);
          }
        }
        this.sendSSDPMSearch();
      });
    } catch (err) {
      console.error('[TVDiscovery] Failed to init SSDP:', err);
    }
  }

  private sendSSDPMSearch() {
    if (!this.udpSocket) return;

    const targets = [
      'ssdp:all',
      'urn:schemas-upnp-org:device:MediaRenderer:1',
      'urn:dial-multiscreen-org:service:dial:1',
    ];

    const lanIps = getLocalIPv4Addresses();

    targets.forEach((st) => {
      const message = Buffer.from(
        `M-SEARCH * HTTP/1.1\r\n` +
        `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\n` +
        `MAN: "ssdp:discover"\r\n` +
        `MX: 3\r\n` +
        `ST: ${st}\r\n\r\n`
      );

      for (const ip of lanIps) {
        try {
          this.udpSocket?.setMulticastInterface(ip);
          this.udpSocket?.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS);
        } catch {
          try {
            this.udpSocket?.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS);
          } catch {}
        }
      }
    });
  }

  private parseSSDPResponse(raw: string, ip: string) {
    if (!raw.includes('HTTP/1.1 200 OK') && !raw.includes('NOTIFY')) return;

    const headers: Record<string, string> = {};
    raw.split('\r\n').forEach((line) => {
      const idx = line.indexOf(':');
      if (idx !== -1) {
        const key = line.slice(0, idx).trim().toUpperCase();
        const val = line.slice(idx + 1).trim();
        headers[key] = val;
      }
    });

    const server = headers['SERVER'] || headers['USN'] || '';
    const location = headers['LOCATION'];

    if (location && location.startsWith('http')) {
      this.fetchDeviceXmlDescription(location, ip, server);
    } else {
      this.registerBasicSSDPDevice(ip, server);
    }
  }

  private fetchDeviceXmlDescription(urlStr: string, ip: string, serverHeader: string) {
    try {
      const req = http.get(urlStr, { timeout: 2500 }, (res) => {
        let xml = '';
        res.on('data', (chunk) => { xml += chunk; });
        res.on('end', () => {
          this.parseDeviceXml(xml, ip, serverHeader);
        });
      });
      req.on('error', () => {
        this.registerBasicSSDPDevice(ip, serverHeader);
      });
    } catch {
      this.registerBasicSSDPDevice(ip, serverHeader);
    }
  }

  private parseDeviceXml(xml: string, ip: string, serverHeader: string) {
    const friendlyNameMatch = xml.match(/<friendlyName>([^<]+)<\/friendlyName>/i);
    const manufacturerMatch = xml.match(/<manufacturer>([^<]+)<\/manufacturer>/i);
    const modelNameMatch = xml.match(/<modelName>([^<]+)<\/modelName>/i);
    const deviceTypeMatch = xml.match(/<deviceType>([^<]+)<\/deviceType>/i);

    const friendlyName = friendlyNameMatch ? friendlyNameMatch[1].trim() : null;
    const manufacturer = manufacturerMatch ? manufacturerMatch[1].trim() : '';
    const modelName = modelNameMatch ? modelNameMatch[1].trim() : undefined;
    const deviceType = deviceTypeMatch ? deviceTypeMatch[1].trim() : '';

    // Ignore routers / network gateways that are not media renderers
    if (deviceType.toLowerCase().includes('internetgatewaydevice') ||
        manufacturer.toLowerCase().includes('d-link') ||
        manufacturer.toLowerCase().includes('openwrt')) {
      return;
    }

    // Only process TV, display, console or media devices
    const combined = `${friendlyName || ''} ${manufacturer} ${modelName || ''} ${serverHeader} ${deviceType}`.toLowerCase();
    
    let brand: SmartTVDevice['brand'] = 'generic';
    let type: SmartTVDevice['type'] = 'tv';

    if (combined.includes('lg') || combined.includes('webos')) {
      brand = 'lg';
    } else if (combined.includes('samsung') || combined.includes('tizen')) {
      brand = 'samsung';
    } else if (combined.includes('apple') || combined.includes('airplay')) {
      brand = 'appletv';
      type = 'streaming_box';
    } else if (combined.includes('roku')) {
      brand = 'roku';
      type = 'streaming_box';
    } else if (combined.includes('fire') || combined.includes('aft')) {
      brand = 'firetv';
      type = 'streaming_box';
    } else if (combined.includes('ps5') || combined.includes('playstation')) {
      brand = 'androidtv';
      type = 'console';
    } else if (combined.includes('bravia') || combined.includes('sony') || combined.includes('android') || combined.includes('google') || combined.includes('tcl') || combined.includes('philips') || combined.includes('mibox') || combined.includes('cobalt')) {
      brand = 'androidtv';
    } else if (combined.includes('moonlight')) {
      brand = 'moonlight';
      type = 'moonlight_app';
    } else if (!combined.includes('tv') && !combined.includes('display') && !combined.includes('mediarenderer')) {
      return;
    }

    const name = friendlyName || `${brand.toUpperCase()} Smart TV (${ip})`;
    const deviceId = `ssdp-${ip}-${brand}`;
    const existing = this.devices.get(deviceId) || this.findByIp(ip);

    const device: SmartTVDevice = {
      id: existing ? existing.id : deviceId,
      name: name,
      ip,
      brand,
      model: modelName,
      status: existing?.status || 'online',
      isMoonlightPaired: existing?.isMoonlightPaired || false,
      clientUuid: existing?.clientUuid,
      type,
      lastSeen: Date.now(),
    };

    this.devices.set(device.id, device);
    this.notifyUpdate();
  }

  private registerBasicSSDPDevice(ip: string, serverHeader: string) {
    const lower = serverHeader.toLowerCase();
    let brand: SmartTVDevice['brand'] = 'generic';

    if (lower.includes('lg') || lower.includes('webos')) brand = 'lg';
    else if (lower.includes('samsung') || lower.includes('tizen')) brand = 'samsung';
    else if (lower.includes('roku')) brand = 'roku';
    else if (lower.includes('android') || lower.includes('google') || lower.includes('sony') || lower.includes('cobalt')) brand = 'androidtv';
    else return;

    const deviceId = `ssdp-${ip}-${brand}`;
    if (this.devices.has(deviceId)) return;

    const device: SmartTVDevice = {
      id: deviceId,
      name: `Smart TV ${brand.toUpperCase()} (${ip})`,
      ip,
      brand,
      status: 'online',
      isMoonlightPaired: false,
      type: 'tv',
      lastSeen: Date.now(),
    };

    this.devices.set(device.id, device);
    this.notifyUpdate();
  }

  // ------------------------------------------------------------
  // Sunshine Paired Clients Integration
  // ------------------------------------------------------------
  private async correlateWithSunshineClients() {
    try {
      const clients: MoonlightClient[] = await getMoonlightClients();
      const stats = await getStreamStats();

      clients.forEach((client) => {
        let matched = false;
        for (const dev of this.devices.values()) {
          if (dev.name.toLowerCase().includes(client.name.toLowerCase()) || client.name.toLowerCase().includes(dev.name.toLowerCase())) {
            dev.isMoonlightPaired = true;
            dev.clientUuid = client.uuid;
            dev.status = stats.isStreaming ? 'streaming' : 'paired';
            matched = true;
            break;
          }
        }

        if (!matched) {
          const id = `moonlight-${client.uuid}`;
          let brand: SmartTVDevice['brand'] = 'moonlight';
          const lower = client.name.toLowerCase();
          if (lower.includes('lg') || lower.includes('webos')) brand = 'lg';
          else if (lower.includes('samsung') || lower.includes('tizen')) brand = 'samsung';
          else if (lower.includes('android') || lower.includes('tv') || lower.includes('google') || lower.includes('shield')) brand = 'androidtv';
          else if (lower.includes('apple') || lower.includes('ios') || lower.includes('ipad')) brand = 'appletv';

          this.devices.set(id, {
            id,
            name: client.name || 'Dispositivo Moonlight',
            ip: 'Rede Local',
            brand,
            status: stats.isStreaming ? 'streaming' : 'paired',
            isMoonlightPaired: true,
            clientUuid: client.uuid,
            type: 'moonlight_app',
            lastSeen: Date.now(),
          });
        }
      });

      this.notifyUpdate();
    } catch {}
  }

  private findByIp(ip: string): SmartTVDevice | undefined {
    for (const dev of this.devices.values()) {
      if (dev.ip === ip) return dev;
    }
    return undefined;
  }

  private notifyUpdate() {
    this.emit('devices-updated', Array.from(this.devices.values()));
  }
}
