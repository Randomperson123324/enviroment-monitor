'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CLIENT_FALLBACK } from '@/config/client';
import { aiHeaders } from '@/lib/ai-client';

/**
 * Cached per-tab AI summary from GET /api/ai/summary.
 *
 * The server owns the refresh window; this only re-asks on the same cadence and
 * gets the cached copy back in between. `refresh()` forces a regeneration.
 */
export default function useAiSummary({ scope, apiBase, deviceId, settings, pollMs, enabled = true }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Header values only — a fresh object each render would restart the interval.
  const headerKey = JSON.stringify(aiHeaders(settings));
  const inFlight = useRef(null);

  const load = useCallback(
    async (force = false) => {
      inFlight.current?.abort();
      const ctrl = new AbortController();
      inFlight.current = ctrl;
      setLoading(true);
      setError('');
      try {
        const q = new URLSearchParams({ scope });
        if (deviceId) q.set('device_id', deviceId);
        if (force) q.set('force', '1');
        const r = await fetch(`${apiBase}/api/ai/summary?${q}`, {
          headers: JSON.parse(headerKey),
          cache: 'no-store',
          signal: ctrl.signal,
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        setData(d);
      } catch (e) {
        if (e.name === 'AbortError') return;
        setError(e.message);
      } finally {
        if (inFlight.current === ctrl) setLoading(false);
      }
    },
    [scope, apiBase, deviceId, headerKey]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const every = pollMs || CLIENT_FALLBACK.aiSummaryPollMs;
    const timer = setInterval(() => load(), every);
    return () => {
      clearInterval(timer);
      inFlight.current?.abort();
    };
  }, [enabled, load, pollMs]);

  return { data, loading, error, refresh: () => load(true) };
}
