import net from 'node:net';
import os from 'node:os';

/** True for the addresses a request from this machine arrives with (IPv4, IPv6 and IPv4-mapped loopback). */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const a = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (a === '::1') return true;
  return net.isIPv4(a) && a.startsWith('127.');
}

function isPrivateIPv4(a: string): boolean {
  if (a.startsWith('10.') || a.startsWith('192.168.')) return true;
  const m = /^172\.(\d+)\./.exec(a);
  return m !== null && Number(m[1]) >= 16 && Number(m[1]) <= 31;
}

/**
 * IPv4 addresses of this machine that a phone on the same network can reach: non-internal, non-link-local,
 * private ranges first, physical interfaces (`en*`) before tunnels.
 */
export function lanAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const found: Array<{ address: string; rank: number }> = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    for (const i of infos ?? []) {
      if (i.internal || i.family !== 'IPv4' || i.address.startsWith('169.254.')) continue;
      const rank = (isPrivateIPv4(i.address) ? 0 : 2) + (/^(en|eth|wl|wlan)/.test(name) ? 0 : 1);
      found.push({ address: i.address, rank });
    }
  }
  found.sort((a, b) => a.rank - b.rank || a.address.localeCompare(b.address));
  return [...new Set(found.map((f) => f.address))];
}

/** `SYNAPSE_HOST` wins; otherwise the `server.lanAccess` setting picks all interfaces or loopback only. */
export function resolveBindHost(pinned: string | null, lanAccess: boolean): string {
  return pinned ?? (lanAccess ? '0.0.0.0' : '127.0.0.1');
}

export function bindsLan(host: string): boolean {
  return !isLoopbackAddress(host) && host !== 'localhost';
}
