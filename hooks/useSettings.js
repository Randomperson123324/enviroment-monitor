'use client';

import { useCallback, useEffect, useState } from 'react';
import { STORAGE, CLIENT_FALLBACK } from '@/config/client';

/**
 * Every AI field defaults to '' — meaning "use the server's own configuration".
 * Only what the user actually types is sent as an x-ai-* override, so a blank
 * dialog behaves exactly like the deployment's env vars.
 */
const DEFAULTS = {
  apiBase: '',
  geminiKey: '',
  aiOrder: '',
  aiLocalBase: '',
  aiLocalModel: '',
  aiGeminiBase: '',
  aiGeminiModel: '',
  aiRelay: '',
  pollMs: CLIENT_FALLBACK.pollMsDefault,
};

/** Keys persisted verbatim as strings (everything except the numeric poll interval). */
const TEXT_KEYS = Object.keys(DEFAULTS).filter((k) => k !== 'pollMs');

/** User-adjustable settings persisted in localStorage. */
export default function useSettings() {
  const [settings, setSettings] = useState(DEFAULTS);

  useEffect(() => {
    const loaded = { pollMs: Number(localStorage.getItem(STORAGE.pollMs)) || DEFAULTS.pollMs };
    for (const k of TEXT_KEYS) loaded[k] = localStorage.getItem(STORAGE[k]) ?? DEFAULTS[k];
    setSettings(loaded);
  }, []);

  const save = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      for (const k of TEXT_KEYS) localStorage.setItem(STORAGE[k], next[k] ?? '');
      localStorage.setItem(STORAGE.pollMs, String(next.pollMs));
      return next;
    });
  }, []);

  return { settings, save };
}
