/**
 * Rule-based analysis engine: health score, issues, and recommendations.
 * All thresholds come from config/sensors.js; all wording from config/messages.th.js.
 */
import { THRESHOLDS, SCORE_PENALTY, SENSORS, scoreBand } from '@/config/sensors';
import { MSG, fill } from '@/config/messages.th';

/**
 * Reads as a number only if it really is one. `Number(null)` is 0, so a column
 * the device could not read would otherwise be scored as a genuine zero — the
 * exact confusion the ingest contract forbids (docs/05-data-schema.md §3).
 */
const has = (v) => v != null && v !== '' && Number.isFinite(Number(v));

/** Linear interpolation of y between (x0,y0)→(x1,y1), clamped to the segment. */
function lerp(x, x0, y0, x1, y1) {
  if (x1 === x0) return y1;
  const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  return y0 + t * (y1 - y0);
}

/** Penalty for a symmetric ok/warn band sensor (temp, hum). */
function bandPenalty(v, t, p) {
  if (v >= t.okLo && v <= t.okHi) return 0;
  if (v < t.okLo) {
    if (v >= t.warnLo) return lerp(v, t.okLo, 0, t.warnLo, p.warn);
    return lerp(v, t.warnLo, p.warn, t.min, p.danger);
  }
  if (v <= t.warnHi) return lerp(v, t.okHi, 0, t.warnHi, p.warn);
  return lerp(v, t.warnHi, p.warn, t.max, p.danger);
}

/** Penalty for a one-sided rising sensor (PM) — escalating. */
function risingPenalty(v, t, p) {
  if (v <= t.clean) return 0;
  if (v <= t.warn) return lerp(v, t.clean, 0, t.warn, p.warn);
  if (v <= t.danger) return lerp(v, t.warn, p.warn, t.danger, p.danger);
  return lerp(v, t.danger, p.danger, t.critical, p.critical);
}

/** Scoring math per threshold shape — sensors declare the shape, not the formula. */
const PENALTY_BY_SHAPE = { band: bandPenalty, rising: risingPenalty };

/**
 * 0–100 room-health score from a raw reading. Every sensor with an entry in
 * SCORE_PENALTY contributes; missing values are skipped, so a device that only
 * reports temperature and humidity scores on those two alone.
 */
export function healthScore(reading) {
  let score = 100;
  for (const s of SENSORS) {
    const penalty = SCORE_PENALTY[s.id];
    if (!penalty || !has(reading?.[s.field])) continue;
    score -= PENALTY_BY_SHAPE[s.shape](Number(reading[s.field]), THRESHOLDS[s.id], penalty);
  }
  return Math.round(Math.min(100, Math.max(0, score)));
}

function buildIssues(reading) {
  return SENSORS.map((s) => {
    if (!has(reading[s.field])) return { sensor: s.id, level: '', msg: MSG.issues[s.id].ok };
    const v = Number(reading[s.field]);
    return { sensor: s.id, level: s.level(v), msg: MSG.issues[s.id][s.issueKey(v)] };
  });
}

/** Danger before warning, so the most urgent line leads the list. */
const ADVICE_RANK = { danger: 0, warning: 1, ok: 2 };

function buildRecommendations(reading) {
  const recs = [];
  for (const s of SENSORS) {
    if (!has(reading[s.field])) continue;
    const v = Number(reading[s.field]);
    const advice = s.advice(v);
    if (!advice) continue;
    recs.push({
      level: advice.level,
      text: fill(MSG.recommendations[s.id][advice.key], {
        v: v.toFixed(s.dp),
        std: THRESHOLDS[s.id].danger ?? '',
      }),
    });
  }
  if (!recs.length) recs.push({ level: 'ok', text: MSG.recommendations.allOk });
  return recs.sort((a, b) => ADVICE_RANK[a.level] - ADVICE_RANK[b.level]);
}

/** Full local analysis object attached to readings as `ai_analysis`. */
export function analyzeReading(reading) {
  const score = healthScore(reading);
  const band = scoreBand(score);
  return {
    score,
    emoji: band.emoji,
    msg: band.msg,
    issues: buildIssues(reading),
    recommendations: buildRecommendations(reading),
    ai_source: 'local',
  };
}

/** Decorate a raw DB row with health_score (+ optionally full analysis). */
export function decorateRow(row, { withAnalysis = false } = {}) {
  if (!row) return row;
  const health_score = healthScore(row);
  const out = { ...row, health_score };
  if (withAnalysis) out.ai_analysis = analyzeReading(row);
  return out;
}

const fmt = (v, dp) => (has(v) ? Number(v).toFixed(dp) : '--');

/** One-line Thai summary of a reading (chat fallback / prompts). */
export function readingSummary(reading) {
  if (!reading) return MSG.chat.noData;
  const hasPm = [reading.pm1, reading.pm25, reading.pm10].some(has);
  return [
    fill(MSG.summary.climate, {
      t: fmt(reading.temperature, 1),
      h: fmt(reading.humidity, 1),
    }),
    hasPm
      ? fill(MSG.summary.pm, {
          p1: fmt(reading.pm1, 0),
          p25: fmt(reading.pm25, 0),
          p10: fmt(reading.pm10, 0),
        })
      : '',
    fill(MSG.summary.score, { s: healthScore(reading) }),
  ]
    .filter(Boolean)
    .join(' · ');
}
