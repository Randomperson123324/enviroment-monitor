'use client';

/**
 * Two things the browser engine needs that a server provider does not:
 * splitting Qwen3's `<think>` block out of the answer, and guessing how far
 * along the prefill is.
 *
 * Ported from StreeFlood's `lib/ai/local/shared.ts`, minus the CPU path. The
 * `anchor()` half of its progress tracker existed only because wllama reports
 * real per-batch prefill progress; WebLLM reports none, so what is left here is
 * the estimator and the calibration that keeps the estimate honest.
 */

/**
 * Pull Qwen3's reasoning block out of the text.
 *
 * Handles an unclosed `<think>` — mid-stream that is the normal state, and
 * everything after the tag is reasoning until proven otherwise. Even with
 * thinking off the model sometimes emits an empty pair, so this runs always.
 */
export function splitThinking(text) {
  const thinkingParts = [];
  let answer = '';
  let rest = text;
  let inThink = false;

  for (;;) {
    const open = rest.indexOf('<think>');
    if (open === -1) {
      answer += rest;
      break;
    }
    answer += rest.slice(0, open);
    rest = rest.slice(open + '<think>'.length);
    const close = rest.indexOf('</think>');
    if (close === -1) {
      thinkingParts.push(rest);
      inThink = true;
      break;
    }
    thinkingParts.push(rest.slice(0, close));
    rest = rest.slice(close + '</think>'.length);
  }
  return { thinking: thinkingParts.join('').trim(), answer: answer.replace(/^\s+/, ''), inThink };
}

const CAL_KEY = 'em_ai_prefill_cal_gpu';
/**
 * Starting guesses, before this machine has ever run one. Deliberately
 * pessimistic on rate: a bar that moves faster than predicted reads as fast,
 * while one that reaches 99% and sits there reads as broken.
 *
 * charsPerToken: with Thai and English mixed, Qwen's tokenizer lands near 3.
 */
const DEFAULT_CAL = { rate: 200, charsPerToken: 3 };

/** What this machine actually measured last time, or null. */
export function getPrefillCalibration() {
  try {
    const raw = window.localStorage.getItem(CAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ok = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
    if (!ok(parsed.rate) || !ok(parsed.charsPerToken)) return null;
    return {
      rate: parsed.rate,
      charsPerToken: parsed.charsPerToken,
      decodeRate: ok(parsed.decodeRate) ? parsed.decodeRate : undefined,
    };
  } catch {
    // No localStorage, or garbage in it — treat as never measured.
    return null;
  }
}

export function recordPrefillCalibration(update) {
  const valid = (n) => (n && Number.isFinite(n) && n > 0 ? n : undefined);
  const rate = valid(update.rate);
  const charsPerToken = valid(update.charsPerToken);
  const decodeRate = valid(update.decodeRate);
  if (!rate && !charsPerToken && !decodeRate) return;

  const current = getPrefillCalibration() ?? DEFAULT_CAL;
  try {
    window.localStorage.setItem(
      CAL_KEY,
      JSON.stringify({
        rate: rate ?? current.rate,
        charsPerToken: charsPerToken ?? current.charsPerToken,
        decodeRate: decodeRate ?? current.decodeRate,
      })
    );
  } catch {
    // Failing to store only costs the adaptation; next run uses the defaults.
  }
}

/**
 * "Analysing prompt X%" while the model chews through the system prompt.
 *
 * WebLLM emits no event during prefill, so the percentage is an estimate: prompt
 * length ÷ measured chars-per-token ÷ measured tokens-per-second. It runs
 * straight to 85% and then eases toward 99 asymptotically, so an underestimate
 * slows down instead of hitting the end and stopping — the one shape that is
 * indistinguishable from a hang.
 *
 * The numbers come from the previous run on this machine (`usage.extra`, saved
 * to localStorage), which is why the second question feels better calibrated
 * than the first.
 */
export function trackPrefillProgress({ promptChars, onTick }) {
  const cal = getPrefillCalibration() ?? DEFAULT_CAL;
  const estTokens = Math.max(1, promptChars / cal.charsPerToken);
  const expectedMs = (estTokens / cal.rate) * 1000;
  const startedAt = Date.now();

  const currentPct = () => {
    const linear = (Date.now() - startedAt) / expectedMs;
    return linear <= 0.85 ? linear * 100 : 85 + 14 * (1 - Math.exp(-(linear - 0.85) / 1.5));
  };

  onTick(0);
  const interval = setInterval(() => onTick(Math.min(99, Math.round(currentPct()))), 250);

  let stopped = false;
  const stop = () => {
    stopped = true;
    clearInterval(interval);
  };

  return {
    /** First token arrived — stop ticking and keep what this run taught us. */
    done: () => {
      if (stopped) return;
      stop();
      const elapsedSec = (Date.now() - startedAt) / 1000;
      // Under 0.2s the rate is not measurable (short prompt, or a KV-cache hit).
      if (elapsedSec < 0.2) return;
      recordPrefillCalibration({ rate: estTokens / elapsedSec });
    },
    /** Ended without a token (error, cancel) — stop, and record nothing. */
    cancel: stop,
  };
}
