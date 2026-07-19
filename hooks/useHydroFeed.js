'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Generic polled JSON feed with manual refresh and last-good-data retention:
 * a failed poll keeps the previous payload visible and only flags the error.
 */
export default function useHydroFeed({ url, refreshMs, label, addLog }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setData(d);
      setError(null);
      setLastFetched(Date.now());
    } catch (e) {
      setError(e.message);
      addLog(`[${label}] โหลดข้อมูลไม่สำเร็จ: ${e.message}`, 'warn');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [url, label, addLog]);

  useEffect(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, refreshMs);
    return () => clearInterval(timer);
  }, [load, refreshMs]);

  const refresh = useCallback(() => {
    setLoading(true);
    load();
  }, [load]);

  return { data, error, loading, lastFetched, refresh };
}
