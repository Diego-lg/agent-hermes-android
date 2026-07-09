/**
 * useDiscoveredHosts — a small hook that owns the LAN discovery state and
 * periodic re-scan. Loaded lazily from HomeScreen so we don't run the
 * scan until the user actually opens Home (saves CPU + battery + 1.5-3
 * seconds of LAN traffic on cold start).
 *
 * State held:
 *   - hosts:   the merged discovered-host list
 *   - loading: true while a scan is in flight
 *   - lastScanAt: epoch ms of last successful scan
 *
 * Methods:
 *   - refresh(opts?)   re-scan now; returns the new list
 *   - switchTo(host)   set config.host to that IP and trigger AppContext.retryConnect
 *
 * Re-scans are throttled: scans within 30s of a prior one are no-ops.
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {
  DiscoveredHost,
  discoverAndCache,
  loadCachedDiscoveredHosts,
} from '../api/lanDiscovery';

export function useDiscoveredHosts(seedHost: string, port: number) {
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<number>(0);
  const inFlight = useRef(false);
  const lastRunRef = useRef(0);

  // Load cache once on mount so the banner can show previously-found
  // hosts immediately (without waiting for the first scan to finish).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cache = await loadCachedDiscoveredHosts();
      if (cancelled) return;
      setHosts(cache.hosts);
      setLastScanAt(cache.lastScanAt);
      // If we have no current connection AND we have any cached discoveries,
      // refresh in the background — saves the user a manual tap.
      const newest = cache.lastScanAt;
      if (cache.hosts.length > 0 && Date.now() - newest > 60_000) {
        void doScan();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doScan = useCallback(async () => {
    if (inFlight.current) return;
    if (Date.now() - lastRunRef.current < 30_000) {
      // Throttled: a fresh scan request under 30s after the last one is
      // suppressed. The UI shows a separate "scanning…" indicator so
      // taps still feel responsive even when suppressed.
      return;
    }
    lastRunRef.current = Date.now();
    inFlight.current = true;
    setLoading(true);
    try {
      const cache = await discoverAndCache({host: seedHost, port});
      setHosts(cache.hosts);
      setLastScanAt(cache.lastScanAt);
    } catch {/* keep existing list */}
    finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [seedHost, port]);

  return {hosts, loading, lastScanAt, refresh: doScan};
}
