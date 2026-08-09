'use client';

import { useEffect, useState } from 'react';
import { DATA_AGE } from '@/config/client';
import { useLang } from '@/hooks/useLang';

/**
 * How stale the newest reading is, re-rendered on its own timer so the label
 * keeps counting up between polls. Shared by the top bar and the sidebar.
 */
export default function DataAge({ createdAt }) {
  const { t } = useLang();
  const [, force] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => force((n) => n + 1), DATA_AGE.tickMs);
    return () => clearInterval(timer);
  }, []);

  if (!createdAt) return null;
  const mins = Math.round((Date.now() - Date.parse(createdAt)) / 60000);
  if (!Number.isFinite(mins)) return null;

  const color =
    mins <= DATA_AGE.freshMin
      ? 'var(--lv-ok)'
      : mins <= DATA_AGE.staleMin
        ? 'var(--lv-warning)'
        : 'var(--lv-danger)';

  return (
    <span className="data-age" style={{ color }}>
      {mins <= 1 ? t('header.agoJustNow') : t('header.agoMinutes', { n: mins })}
    </span>
  );
}
