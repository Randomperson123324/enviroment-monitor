/**
 * Turns a movement reading + the user's threshold into a 0-100 score and a
 * good/bad verdict, direction set by the selected FOCUS_MODES entry — never
 * duplicated per component, so the chart, the cards, and the alert bar always
 * agree on what "good" means for the current mode.
 */
import {
  FOCUS_MODES,
  FOCUS_MODE_DEFAULT,
  FOCUS_SCORE_PENALTY,
  FOCUS_LOW_BANDS,
} from '@/config/client';
import { scoreBand } from '@/config/sensors';

export function focusModeConfig(modeId) {
  return (
    FOCUS_MODES.find((m) => m.id === modeId) ??
    FOCUS_MODES.find((m) => m.id === FOCUS_MODE_DEFAULT) ??
    FOCUS_MODES[0]
  );
}

/**
 * 0-100: how close the reading is to the mode's goal. 'gain' modes (activity)
 * reward movement up to the threshold; 'lose' modes (listening) reward
 * staying under it. Both scale off the same threshold the alert already
 * uses, so raising it moves the goalposts for the score too.
 */
export function focusScore(movement, threshold, modeId) {
  if (movement == null || !Number.isFinite(threshold) || threshold <= 0) return null;
  const ratio = Math.min(Math.max(movement, 0) / threshold, 1);
  const pct = focusModeConfig(modeId).over === 'gain' ? ratio * 100 : (1 - ratio) * 100;
  return Math.round(pct);
}

/** Is this movement reading on the mode's good side of the threshold? */
export function isFocusGood(movement, threshold, modeId) {
  if (movement == null || !Number.isFinite(threshold)) return null;
  const over = movement > threshold;
  return focusModeConfig(modeId).over === 'gain' ? over : !over;
}

/**
 * Share of a window carrying one label, merged across every person on screen —
 * `null` when nothing measured it at all.
 *
 * The distinction matters as much here as it does for a sensor that did not
 * report: no rows with a phone verdict is "not checked", which must skip the
 * penalty, while rows that all said `off` is a measured 0 that earns it.
 */
function labelShare(series, mixKey, label) {
  let total = 0;
  let hits = 0;
  for (const s of series) {
    const mix = s[mixKey];
    if (!mix?.total) continue;
    total += mix.total;
    for (const part of mix.parts) if (part.label === label) hits += part.count;
  }
  return total ? hits / total : null;
}

/**
 * The section's one number: 0-100 for the whole window, everyone in it, built
 * exactly the way the room-health score is — start at 100, subtract a penalty
 * per signal, clamp, then read the band off the **same** SCORE_BANDS cutoffs so
 * a 62 on this ring means what a 62 on the environment ring means (and paints
 * in the same SCORE_BAND_COLORS).
 *
 * It is deliberately not the score on the card below it: that one answers "how
 * is the room *right now*" from the newest minute, which flickers, while this
 * answers "how has this session gone" across every minute the chart draws.
 *
 * `buckets` are the all-people totals per minute — the same series the movement
 * threshold and its alert already work in, so raising the threshold moves this
 * score's goalposts too and no new unit is introduced.
 */
export function overallFocusScore({ buckets = [], series = [], threshold, modeId }) {
  const movements = buckets.map((b) => b.movement).filter((v) => Number.isFinite(v));
  if (!movements.length) return null;

  const mean = movements.reduce((a, v) => a + v, 0) / movements.length;
  const engagement = focusScore(mean, threshold, modeId);
  if (engagement == null) return null;

  const parts = [
    // Shortfall against the mode's goal, not the raw reading: in a listening
    // session little movement is the goal, in an activity session it is the fault.
    { id: 'engagement', share: (100 - engagement) / 100 },
    { id: 'phone', share: labelShare(series, 'phoneMix', FOCUS_SCORE_PENALTY.phone.label) },
    { id: 'posture', share: labelShare(series, 'postureMix', FOCUS_SCORE_PENALTY.posture.label) },
  ]
    .filter((p) => p.share != null)
    .map((p) => ({ ...p, penalty: p.share * FOCUS_SCORE_PENALTY[p.id].max }));

  const raw = parts.reduce((score, p) => score - p.penalty, 100);
  const score = Math.round(Math.min(100, Math.max(0, raw)));
  const band = scoreBand(score);

  return {
    score,
    band,
    low: FOCUS_LOW_BANDS.includes(band.id),
    // Rounded only for display; the score above is built from the exact shares.
    parts: parts.map((p) => ({ ...p, penalty: Math.round(p.penalty) })),
    minutes: buckets.length,
    people: series.length,
    meanMovement: Math.round(mean),
  };
}
