import { Global, Injectable, Module } from '@nestjs/common';
import { networkInterfaces } from 'node:os';
import { DatabaseService } from '../database/database.service';

export type NetworkMode = 'ALL' | 'WIRED';

export interface NetworkAdapter {
  name: string;
  address: string;
  netmask: string;
  network: string;
  kind: 'wired' | 'wireless' | 'virtual';
}

export interface NetworkStatus {
  adapters: NetworkAdapter[];
  wiredSubnets: string[];
  warnings: string[];
}

const WIRELESS_NAME = /(^|[^a-z])(wi-?fi|wlan|wlp\d+|wl\d+|wireless|airport)/i;
const VIRTUAL_NAME =
  /(vethernet|virtual|vmware|virtualbox|vbox|hyper-v|hyper v|docker|wsl|loopback|bluetooth|tailscale|zerotier|^tap|^tun)/i;

function classify(name: string): NetworkAdapter['kind'] {
  if (VIRTUAL_NAME.test(name)) return 'virtual';
  if (WIRELESS_NAME.test(name)) return 'wireless';
  return 'wired';
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function ipv4(remote: string | undefined): string | null {
  if (!remote) return null;
  const value = remote.startsWith('::ffff:') ? remote.slice(7) : remote;
  return ipv4ToInt(value) === null ? null : value;
}

function networkOf(address: string, netmask: string): string | null {
  const a = ipv4ToInt(address);
  const m = ipv4ToInt(netmask);
  if (a === null || m === null) return null;
  const network = (a & m) >>> 0;
  return [
    (network >>> 24) & 255,
    (network >>> 16) & 255,
    (network >>> 8) & 255,
    network & 255,
  ].join('.');
}

function inSubnet(client: string, network: string, netmask: string): boolean {
  const c = ipv4ToInt(client);
  const n = ipv4ToInt(network);
  const m = ipv4ToInt(netmask);
  if (c === null || n === null || m === null) return false;
  return ((c & m) >>> 0) === ((n & m) >>> 0);
}

function prefixLength(netmask: string): number {
  const m = ipv4ToInt(netmask);
  if (m === null) return 32;
  let bits = 0;
  for (let i = 31; i >= 0; i--) {
    if ((m & (1 << i)) !== 0) bits++;
    else break;
  }
  return bits;
}

/**
 * Enforces the "cable only" lock and reports which adapters the server treats
 * as wired. A client's physical link type is never visible to the server, so
 * the lock allows only clients whose address falls inside the subnet of a
 * wired adapter on this machine. When cable and Wi-Fi share one bridged
 * subnet the server cannot tell them apart — the UI says so explicitly.
 */
@Global()
@Injectable()
export class NetworkService {
  private cachedMode: NetworkMode | null = null;
  private cachedAt = 0;

  constructor(private readonly db: DatabaseService) {}

  invalidate(): void {
    this.cachedMode = null;
    this.cachedAt = 0;
  }

  async mode(): Promise<NetworkMode> {
    if (this.cachedMode && Date.now() - this.cachedAt < 5000) return this.cachedMode;
    const r = await this.db.query(
      `SELECT value FROM settings WHERE key = 'network_access'`,
    );
    const mode: NetworkMode = r.rows[0]?.value === 'WIRED' ? 'WIRED' : 'ALL';
    this.cachedMode = mode;
    this.cachedAt = Date.now();
    return mode;
  }

  adapters(): NetworkAdapter[] {
    const out: NetworkAdapter[] = [];
    const interfaces = networkInterfaces();
    for (const [name, addresses] of Object.entries(interfaces)) {
      for (const addr of addresses ?? []) {
        if (addr.family !== 'IPv4' || addr.internal) continue;
        const network = networkOf(addr.address, addr.netmask);
        if (!network) continue;
        out.push({
          name,
          address: addr.address,
          netmask: addr.netmask,
          network,
          kind: classify(name),
        });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  status(): NetworkStatus {
    const adapters = this.adapters();
    const wired = adapters.filter((a) => a.kind === 'wired');
    const wiredSubnets = wired.map(
      (a) => `${a.network}/${prefixLength(a.netmask)}`,
    );
    const warnings: string[] = [];
    if (wired.length === 0) {
      warnings.push(
        'No cable network is connected to this PC. Cable-only mode would block every terminal until an Ethernet adapter is up.',
      );
    } else {
      const wireless = adapters.filter((a) => a.kind === 'wireless');
      const bridged = wireless.some((w) =>
        wired.some((c) => c.network === w.network && c.netmask === w.netmask),
      );
      if (bridged) {
        warnings.push(
          'This PC also has a Wi-Fi adapter on the same subnet as the cable network, so Wi-Fi clients are treated like cable clients. Use a separate Wi-Fi network/VLAN for strict enforcement.',
        );
      }
    }
    return { adapters, wiredSubnets, warnings };
  }

  /** Loopback (the server itself) is always allowed. */
  isAllowed(remote: string | undefined): boolean {
    const client = ipv4(remote);
    if (!client) return false;
    if (client.startsWith('127.')) return true;
    const wired = this.adapters().filter((a) => a.kind === 'wired');
    if (wired.length === 0) return false;
    return wired.some((a) => inSubnet(client, a.network, a.netmask));
  }
}

@Global()
@Module({
  providers: [NetworkService],
  exports: [NetworkService],
})
export class NetworkModule {}
