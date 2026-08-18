/**
 * Turns a movement reading + the user's threshold into a 0-100 score and a
 * good/bad verdict, direction set by the selected FOCUS_MODES entry — never
 * duplicated per component, so the chart, the cards, and the alert bar always
 * agree on what "good" means for the current mode.
 */
import { FOCUS_MODES, FOCUS_MODE_DEFAULT } from '@/config/client';

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
