'use client';

import { useEffect, useState } from 'react';
import { CLIENT_FALLBACK } from '@/config/client';

/** Runtime config from GET /api/config (poll defaults, focus credentials, Gemini flag). */
export default function useServerConfig(apiBase, addLog) {
  const [cfg, setCfg] = useState(CLIENT_FALLBACK);

  useEffect(() => {
    let alive = true;
    fetch(`${apiBase}/api/config`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (alive) setCfg({ ...CLIENT_FALLBACK, ...data });
      })
      .catch((e) => addLog(`Config GET: ${e.message}`, 'warn'));
    return () => {
      alive = false;
    };
  }, [apiBase, addLog]);

  return cfg;
}
