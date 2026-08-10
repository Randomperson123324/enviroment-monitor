'use client';

import { useEffect, useState } from 'react';
import { DATA_AGE } from '@/config/client';
import { formatAge, timestampLabel } from '@/lib/format';
import { useLang } from '@/hooks/useLang';

/**
 * How trustworthy the newest reading is, as one object every surface can read.
 *
 * The dashboard used to show only "N นาทีที่แล้ว", which turns into nonsense
 * once a device has been down for weeks, and it never said outright that the
 * numbers on screen are old. Three levels instead:
 *
 *   live    — polling normally
 *   stale   — a few polls missed; values still roughly current
 *   offline — no reading for over an hour; treat what is shown as history
 *
 * Ticks on its own timer so the label keeps counting between polls.
 */
export default function useDataStatus(createdAt) {
  const { t, lang } = useLang();
  const [, force] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => force((n) => n + 1), DATA_AGE.tickMs);
    return () => clearInterval(timer);
  }, []);

  const at = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(at)) {
    return { level: 'none', ageMs: null, ageLabel: '', at: null, atLabel: '', label: t('status.none') };
  }

  const ageMs = Date.now() - at;
  const mins = ageMs / 60000;
  const level = mins <= DATA_AGE.freshMin ? 'live' : mins <= DATA_AGE.offlineMin ? 'stale' : 'offline';
  // Bare duration: every consumer wraps it in its own sentence.
  const ageLabel = formatAge(ageMs, t, 'ageShort');

  return {
    level,
    ageMs,
    ageLabel,
    at,
    atLabel: timestampLabel(createdAt, lang),
    /** Short text for the pill: the state, plus how old when that matters. */
    label: level === 'live' ? t('status.live') : t(`status.${level}`, { age: ageLabel }),
  };
}
