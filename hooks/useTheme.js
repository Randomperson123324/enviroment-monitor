'use client';

import { useCallback, useEffect, useState } from 'react';
import { STORAGE } from '@/config/client';

/** Theme state synced with the <html data-theme> stamp set by the boot script. */
export default function useTheme() {
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || 'dark');
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => {
      if (localStorage.getItem(STORAGE.theme)) return;
      const next = e.matches ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem(STORAGE.theme, next);
      return next;
    });
  }, []);

  return [theme, toggleTheme];
}
