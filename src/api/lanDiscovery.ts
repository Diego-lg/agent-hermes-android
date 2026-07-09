/**
 * lanDiscovery — find desktop Hermes instances on the LAN.
 *
 * The current Hermes desktop server (`hermes serve`) doesn't broadcast itself
 * via mDNS or UDP, so the only way to discover one from the phone is to
 * actively probe the subnet. We do that with a parallel-fetch scan:
 *
 *   - Take the configured `host` (or the OS-provided gateway as fallback),
 *     strip the last octet, and probe every IP in `.1`..`.254` on the
 *     `port` the user has configured (9119 by default).
 *   - Each probe is a `fetch('http://<ip>:<port>/login', {signal: AbortSignal.timeout(1500), redirect: 'manual'})`.
 *     Any response from a TCP/HTTP server counts as "live"; we don't try
 *     to authenticate (we don't have creds yet for unknown hosts). The
 *     read-only `/login` endpoint is the cheapest unambiguous indicator
 *     that this is a Hermes server vs some random LAN device — and we
 *     already ship `cleartextTrafficPermitted=true` in our network config.
 *   - We time-budget the whole scan (~5 sec). On completion, return the
 *     matched hosts in latency order (fastest first). The caller decides
 *     what to do with them.
 *
 * Limits:
 *   - 254 IPs × 1.5s timeout each in parallel = effectively bounded by the
 *     slowest single response (within budget), because rejections are
 *     concurrent. So a full /24 scan is ~1-3 sec on a healthy LAN.
 *   - We do NOT scan a /16 (65k hosts); the user can set a custom range
 *     from Settings if their network is unusual.
 *
 * Replaced the future mDNS scan (which would require server-side help +
 * native mDNS module) with this synchronous http-probe approach.
 */

import {kv, STORAGE_KEYS} from './storage';

export interface DiscoveredHost {
  host: string;
  port: number;
  /** Round-trip time of the probe, in ms. Useful for "best first" sort. */
  rtt: number;
  /** Last successful detection (epoch ms). */
  seenAt: number;
}

export interface DiscoveryOptions {
  host?: string;          // any reachable host on the LAN — we use its /24
  port?: number;          // default 9119
  /** Max IPs to probe in one run (caps the worst-case scan time). */
  maxHosts?: number;
  /** Per-host abort timeout in ms. Default 1500. */
  perHostTimeoutMs?: number;
  /** Total wall-clock budget; returns whatever has been found so far. */
  totalTimeoutMs?: number;
  /** Optional explicit /24 third octet; if `host` is missing, we hit
   *  `<x>.1` only and use a single fallback. Most LAN setups have a
   *  single /24 so this is enough. */
  subnetOctet3?: number;
}

const DEFAULT_PORT = 9119;

function ipToInt(ip: string): number | null {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return null;
  return (parseInt(m[1], 10) << 24 >>> 0)
    | (parseInt(m[2], 10) << 16)
    | (parseInt(m[3], 10) << 8)
    | parseInt(m[4], 10);
}

function intToIp(n: number): string {
  return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
}

/** Returns the /24 neighbor IPs in `.1..254` order with the gateway as
 *  the first probe (gates that are actually box-running Hermes tend to
 *  have the fastest response, so front-loading cuts user-perceived latency).
 *
 *  For an IPv6 / unknown network, returns the empty list — caller falls
 *  back to the single-known-host path. */
export function planScanHosts(seed?: string): string[] {
  if (!seed) return [];
  const n = ipToInt(seed);
  if (n === null) return [];
  const base = n & 0xffffff00;
  const out: string[] = [];
  // gateway first (very common for desktop hosts), then the seed, then the rest
  out.push(intToIp(base | 1));
  out.push(intToIp(n));
  for (let i = 2; i <= 254; i++) {
    if (i === (n & 0xff)) continue; // already added
    out.push(intToIp(base | i));
  }
  return out;
}

async function probeOne(host: string, port: number, timeoutMs: number): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`http://${host}:${port}/login`, {
      method: 'HEAD', // cheap — does not need to actually read the auth challenge
      signal: ctrl.signal,
      // Don't follow the redirect to the SPA; we just want to know if /login 200s.
      redirect: 'manual',
    });
    clearTimeout(timer);
    // 200/302/401 all count as "there's something there". Reject only
    // network-level failures (which threw) or DNS failures (which also throw).
    if (res.status >= 100 && res.status < 600) return Date.now() - t0;
    return null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/** Run the scan. Returns hosts that responded, fastest first. */
export async function scanForHermes(opts: DiscoveryOptions = {}): Promise<DiscoveredHost[]> {
  const port = opts.port ?? DEFAULT_PORT;
  const perHostTimeoutMs = opts.perHostTimeoutMs ?? 1500;
  const totalTimeoutMs = opts.totalTimeoutMs ?? 5000;
  const maxHosts = opts.maxHosts ?? 64;
  const candidates = planScanHosts(opts.host).slice(0, maxHosts);
  if (candidates.length === 0) return [];

  const t0 = Date.now();
  const settled = new Map<number, number>(); // latency(ts in epoch ms) per candidate index
  let idx = -1;
  async function next(): Promise<void> {
    while (true) {
      const myIdx = ++idx;
      if (myIdx >= candidates.length) return;
      if (Date.now() - t0 > totalTimeoutMs) return;
      const rtt = await probeOne(candidates[myIdx], port, perHostTimeoutMs);
      if (rtt !== null) settled.set(myIdx, rtt);
    }
  }
  // 8 parallel probes — enough to saturate a /24 within ~3s on a normal LAN,
  // low enough that we don't fire 254 simultaneous requests.
  const lanes = Array.from({length: 8}, () => next());
  await Promise.all(lanes);

  const seenAt = Date.now();
  const matches: DiscoveredHost[] = [];
  for (const [i, rtt] of settled) {
    matches.push({host: candidates[i], port, rtt, seenAt});
  }
  matches.sort((a, b) => a.rtt - b.rtt);
  return matches;
}

interface DiscoveredCache {
  hosts: DiscoveredHost[];
  /** Last scan attempt, for "scanned Xs ago" UI. */
  lastScanAt: number;
}

const emptyCache: DiscoveredCache = {hosts: [], lastScanAt: 0};

export async function loadCachedDiscoveredHosts(): Promise<DiscoveredCache> {
  try {
    const raw = await kv.getItem(STORAGE_KEYS.discoveredHosts);
    if (!raw) return emptyCache;
    const parsed = JSON.parse(raw) as DiscoveredCache;
    if (!parsed || !Array.isArray(parsed.hosts)) return emptyCache;
    return parsed;
  } catch {
    return emptyCache;
  }
}

export async function saveCachedDiscoveredHosts(c: DiscoveredCache): Promise<void> {
  try {
    await kv.setItem(STORAGE_KEYS.discoveredHosts, JSON.stringify(c));
  } catch {
    /* best-effort */
  }
}

/** One-call helper: scan + persist + return. */
export async function discoverAndCache(opts: DiscoveryOptions = {}): Promise<DiscoveredCache> {
  const prev = await loadCachedDiscoveredHosts();
  const hosts = await scanForHermes(opts);
  // Merge: keep previously-seen hosts that didn't respond this round
  // (could be transient), but refresh the entry's `seenAt` and `rtt`
  // for the ones that did. Capped at 16 entries to keep the cache small.
  const merged = new Map<string, DiscoveredHost>();
  for (const h of prev.hosts) merged.set(h.host, h);
  for (const h of hosts) merged.set(h.host, h);
  const mergedList = Array.from(merged.values()).slice(0, 16);
  const next: DiscoveredCache = {hosts: mergedList, lastScanAt: Date.now()};
  await saveCachedDiscoveredHosts(next);
  return next;
}
