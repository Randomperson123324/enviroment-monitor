'use client';

import { useCallback, useEffect, useState } from 'react';
import { STORAGE, CLIENT_FALLBACK } from '@/config/client';

const DEFAULTS = {
  apiBase: '',
  geminiKey: '',
  pollMs: CLIENT_FALLBACK.pollMsDefault,
};

/** User-adjustable settings persisted in localStorage. */
export default function useSettings() {
  const [settings, setSettings] = useState(DEFAULTS);

  useEffect(() => {
    setSettings({
      apiBase: localStorage.getItem(STORAGE.apiBase) ?? DEFAULTS.apiBase,
      geminiKey: localStorage.getItem(STORAGE.geminiKey) ?? DEFAULTS.geminiKey,
      pollMs: Number(localStorage.getItem(STORAGE.pollMs)) || DEFAULTS.pollMs,
    });
  }, []);

  const save = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STORAGE.apiBase, next.apiBase);
      localStorage.setItem(STORAGE.geminiKey, next.geminiKey);
      localStorage.setItem(STORAGE.pollMs, String(next.pollMs));
      return next;
    });
  }, []);

  return { settings, save };
}
