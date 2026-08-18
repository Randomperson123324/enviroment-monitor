'use client';

import { useEffect, useRef } from 'react';

/**
 * Raise a one-off alert when a score drops into its low band, and keep quiet
 * while it stays there.
 *
 * Written as edge-triggered on purpose. The focus score recomputes on every
 * poll and every realtime insert, so an effect that simply fired "while low"
 * would put a toast on screen three times a minute for a lesson that is having
 * one bad stretch — the user would learn to ignore the very thing meant to
 * catch their eye. A session that stays bad is worth one reminder, not a
 * stream: `repeatMs` is that reminder's spacing, and recovering above the low
 * band re-arms the first alert immediately.
 */
export default function useLowScoreAlert({ low, score, onAlert, repeatMs }) {
  const lastAt = useRef(0);
  const wasLow = useRef(false);

  useEffect(() => {
    if (!low) {
      wasLow.current = false;
      return;
    }
    const now = Date.now();
    if (wasLow.current && now - lastAt.current < repeatMs) return;
    wasLow.current = true;
    lastAt.current = now;
    onAlert(score);
  }, [low, score, onAlert, repeatMs]);
}
