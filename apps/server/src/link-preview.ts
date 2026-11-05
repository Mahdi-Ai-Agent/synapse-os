import { promises as dns } from 'node:dns';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { kindFromUrl, nowIso, platformOf } from '@synapse/core';

/**
 * Link previews for resource cards (UI-DESIGN "Kinds"): title, description, image and site of a URL the user saved,
 * from its Open Graph tags (YouTube through oEmbed), cached in \`<vault>/.synapse/previews.json\`. Only public http(s)
 * hosts are fetched: names resolving to loopback, private, link-local or unique-local addresses are refused, so a
 * saved link can never make the server probe the user's own network.
 */
export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  site?: string;
  platform: string;
  kind: string;
  fetchedAt: string;
  ok: boolean;
}

const MAX_BYTES = 768 * 1024;
const TIMEOUT_MS = 6000;
const MAX_CACHE = 600;

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n))).trim();
}

/** Open Graph / Twitter / <title> fields of an HTML page. */
export function parseMeta(html: string, base: string): Pick<LinkPreview, 'title' | 'description' | 'image' | 'site'> {
  const meta = new Map<string, string>();
  for (const m of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = m[0];
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && content !== undefined && !meta.has(key)) meta.set(key, decode(content));
  }
  const title = meta.get('og:title') ?? meta.get('twitter:title') ?? (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ? decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)![1]!) : undefined);
  const description = meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description');
  let image = meta.get('og:image') ?? meta.get('og:image:url') ?? meta.get('twitter:image');
  if (image) { try { image = new URL(image, base).toString(); } catch { image = undefined; } }
  const site = meta.get('og:site_name');
  return { ...(title ? { title: title.slice(0, 300) } : {}), ...(description ? { description: description.slice(0, 500) } : {}), ...(image ? { image } : {}), ...(site ? { site } : {}) };
}

export async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http(s) links have previews');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new Error('link points to a private address');
}

async function fetchText(url: string, signal: AbortSignal): Promise<{ text: string; finalUrl: string }> {
  let current = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(current);
    const res = await fetch(current, { redirect: 'manual', signal, headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Synapse link preview)', accept: 'text/html,application/json;q=0.9,*/*;q=0.5', 'accept-language': 'fa,en;q=0.8' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { current = new URL(res.headers.get('location')!, current); continue; }
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); break; }
    }
    return { text: Buffer.concat(chunks).toString('utf8'), finalUrl: current.toString() };
  }
  throw new Error('too many redirects');
}

export class LinkPreviewer {
  private cache: Record<string, LinkPreview> | null = null;
  private inflight = new Map<string, Promise<LinkPreview>>();
  constructor(private readonly root: string, private readonly fetchImpl: typeof fetchText = fetchText) {}

  private get file(): string { return path.join(this.root, '.synapse', 'previews.json'); }

  private async load(): Promise<Record<string, LinkPreview>> {
    if (this.cache) return this.cache;
    try { this.cache = JSON.parse(await fs.readFile(this.file, 'utf8')) as Record<string, LinkPreview>; } catch { this.cache = {}; }
    return this.cache;
  }

  private async save(): Promise<void> {
    const all = Object.values(this.cache ?? {}).sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt)).slice(0, MAX_CACHE);
    this.cache = Object.fromEntries(all.map((p) => [p.url, p]));
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.cache) + '\n', 'utf8');
  }

  async preview(url: string): Promise<LinkPreview> {
    const cache = await this.load();
    const hit = cache[url];
    // Failed lookups are retried after a day; good ones live until evicted.
    if (hit && (hit.ok || Date.now() - Date.parse(hit.fetchedAt) < 86_400_000)) return hit;
    const running = this.inflight.get(url);
    if (running) return running;
    const job = this.lookup(url).finally(() => this.inflight.delete(url));
    this.inflight.set(url, job);
    return job;
  }

  private async lookup(url: string): Promise<LinkPreview> {
    const base: LinkPreview = { url, platform: platformOf(url) ?? 'web', kind: kindFromUrl(url), fetchedAt: nowIso(), ok: false };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let out = base;
    try {
      if (base.platform === 'youtube') {
        const r = await this.fetchImpl(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, ctrl.signal);
        const j = JSON.parse(r.text) as { title?: string; author_name?: string; thumbnail_url?: string };
        out = { ...base, ok: true, site: 'YouTube', ...(j.title ? { title: j.title } : {}), ...(j.author_name ? { description: j.author_name } : {}), ...(j.thumbnail_url ? { image: j.thumbnail_url } : {}) };
      } else {
        const r = await this.fetchImpl(url, ctrl.signal);
        const meta = parseMeta(r.text, r.finalUrl);
        out = { ...base, ...meta, ok: Boolean(meta.title || meta.image) };
      }
    } catch { out = base; } finally { clearTimeout(timer); }
    (await this.load())[url] = out;
    await this.save().catch(() => undefined);
    return out;
  }
}
