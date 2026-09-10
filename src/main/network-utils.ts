// SpaceViewer v2.2.9
// ============================================================
// SpaceViewer — Network Utilities & Interface Resolvers
// Ensures real LAN IPs are prioritized and virtual adapters
// (VirtualBox, VMware, VPNs) are filtered from discovery & mDNS.
// ============================================================

import * as os from 'os';
import { exec } from 'child_process';
import { Service } from 'bonjour-service';

/**
 * Returns a list of all active, physical LAN/Wi-Fi IPv4 addresses.
 * Filters out VirtualBox (192.168.56.x), VMware, Fortinet/VPNs, APIPA (169.254.x.x), and loopback.
 */
export function getLocalIPv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const validIps: string[] = [];

  for (const [name, iface] of Object.entries(interfaces)) {
    if (!iface) continue;
    const lower = name.toLowerCase();
    if (
      lower.includes('virtualbox') ||
      lower.includes('vmware') ||
      lower.includes('vethernet') ||
      lower.includes('fortinet') ||
      lower.includes('loopback') ||
      lower.includes('pseudo')
    ) {
      continue;
    }
    for (const addr of iface) {
      if (addr.internal || addr.mac === '00:00:00:00:00:00') continue;
      // Filter out VirtualBox virtual network adapter MAC addresses (0a:00:27 / 08:00:27)
      if (addr.mac && (addr.mac.toLowerCase().startsWith('0a:00:27') || addr.mac.toLowerCase().startsWith('08:00:27'))) {
        continue;
      }
      if (
        addr.family === 'IPv4' &&
        !addr.address.startsWith('192.168.56.') &&
        !addr.address.startsWith('169.254.') &&
        !addr.address.startsWith('127.')
      ) {
        validIps.push(addr.address);
      }
    }
  }

  // Fallback: if no physical adapters matched the filter, return any non-internal IPv4
  if (validIps.length === 0) {
    for (const iface of Object.values(interfaces)) {
      if (!iface) continue;
      for (const addr of iface) {
        if (!addr.internal && addr.family === 'IPv4') {
          validIps.push(addr.address);
        }
      }
    }
  }

  return validIps;
}

/**
 * Get the primary LAN IPv4 address (e.g. 192.168.2.173)
 */
export function getPrimaryLANIPv4(): string {
  const ips = getLocalIPv4Addresses();
  return ips[0] || '127.0.0.1';
}

/**
 * Clean hostname for RFC 6763 / GameStream mDNS compliance (letters, digits, dashes, max 63 chars)
 */
export function getCleanMdnsHostname(): string {
  const raw = os.hostname();
  const cleaned = raw.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 63);
  return cleaned || 'SpaceViewer';
}

let bonjourPatched = false;

/**
 * Patches bonjour-service Service.prototype.records to only publish
 * physical LAN IPv4 addresses, avoiding advertising VirtualBox or VPN IPs to Moonlight.
 */
export function patchBonjourService(): void {
  if (bonjourPatched) return;
  bonjourPatched = true;

  try {
    const proto = Service.prototype as any;
    proto.records = function () {
      const records = [this.RecordPTR(this), this.RecordSRV(this), this.RecordTXT(this)];
      for (const subtype of this.subtypes || []) {
        records.push(this.RecordSubtypePTR(this, subtype));
      }

      const lanIps = getLocalIPv4Addresses();
      const hostName = (this.host || '').replace(/\.local$/, '');

      for (const ip of lanIps) {
        records.push(this.RecordA(this, ip));
        if (hostName) {
          records.push({
            name: `${hostName}.local`,
            type: 'A',
            ttl: 120,
            data: ip,
          });
          records.push({
            name: hostName,
            type: 'A',
            ttl: 120,
            data: ip,
          });
        }
      }

      return records;
    };
    console.log('[SpaceViewer] Bonjour service patched to prioritize physical LAN IPv4 addresses.');
  } catch (err) {
    console.warn('[SpaceViewer] Failed to patch Bonjour service records:', err);
  }
}

/**
 * On Windows, checks if the active network profile is set to Public
 * and automatically changes it to Private to allow mDNS and SSDP discovery.
 */
export function ensurePrivateNetworkProfile(): void {
  if (process.platform !== 'win32') return;

  exec(
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq \'Public\' } | Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue"',
    (err) => {
      if (err) {
        console.warn('[SpaceViewer] Network profile switch notification:', err.message);
      } else {
        console.log('[SpaceViewer] Windows network profile verified (Private mode).');
      }
    }
  );

  ensureGameStreamFirewallRules();
}

/**
 * Ensures Windows Firewall allows inbound traffic for Moonlight GameStream (UDP 47999 / 47998-48010),
 * mDNS discovery (UDP 5353) and WebRTC without executable path restrictions.
 */
export function ensureGameStreamFirewallRules(): void {
  if (process.platform !== 'win32') return;

  const script = `
    $rules = @(
      @{ Name = "SpaceViewer GameStream Ports UDP"; Protocol = "UDP"; Port = "47984-48010" },
      @{ Name = "SpaceViewer GameStream Ports TCP"; Protocol = "TCP"; Port = "47984-48010" },
      @{ Name = "SpaceViewer Discovery UDP"; Protocol = "UDP"; Port = "5353,1900" },
      @{ Name = "SpaceViewer WebRTC TCP"; Protocol = "TCP"; Port = "7523,7524" }
    )
    foreach ($r in $rules) {
      $existing = Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue
      if (-not $existing) {
        New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Action Allow -Profile Any -Protocol $r.Protocol -LocalPort $r.Port -ErrorAction SilentlyContinue | Out-Null
      }
    }
  `;
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${b64}`, (err) => {
    if (!err) {
      console.log('[SpaceViewer] GameStream and Moonlight firewall rules (including UDP 47999) verified.');
    }
  });
}

