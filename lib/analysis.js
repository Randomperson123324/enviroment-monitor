/**
 * Rule-based analysis engine: health score, issues, and recommendations.
 * All thresholds come from config/sensors.js; all wording from config/messages.th.js.
 */
import { THRESHOLDS, SCORE_PENALTY, SENSORS, scoreBand } from '@/config/sensors';
import { MSG, fill } from '@/config/messages.th';

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

/** Penalty for gas (one-sided, escalating). */
function gasPenalty(v, t, p) {
  if (v <= t.clean) return 0;
  if (v <= t.warn) return lerp(v, t.clean, 0, t.warn, p.warn);
  if (v <= t.danger) return lerp(v, t.warn, p.warn, t.danger, p.danger);
  return lerp(v, t.danger, p.danger, t.critical, p.critical);
}

/** 0–100 room-health score from a raw reading. */
export function healthScore(reading) {
  const t = Number(reading?.temperature);
  const h = Number(reading?.humidity);
  const g = Number(reading?.gas_ppm);
  let score = 100;
  if (Number.isFinite(t)) score -= bandPenalty(t, THRESHOLDS.temp, SCORE_PENALTY.temp);
  if (Number.isFinite(h)) score -= bandPenalty(h, THRESHOLDS.hum, SCORE_PENALTY.hum);
  if (Number.isFinite(g)) score -= gasPenalty(g, THRESHOLDS.gas, SCORE_PENALTY.gas);
  return Math.round(Math.min(100, Math.max(0, score)));
}

function buildIssues(reading) {
  return SENSORS.map((s) => {
    const v = Number(reading[s.field]);
    if (!Number.isFinite(v)) return { sensor: s.id, level: '', msg: MSG.issues[s.id].ok };
    const level = s.level(v);
    let msg = MSG.issues[s.id].ok;
    if (level) {
      if (s.id === 'temp') msg = v < THRESHOLDS.temp.okLo ? MSG.issues.temp.cold : MSG.issues.temp.hot;
      if (s.id === 'hum') msg = v < THRESHOLDS.hum.okLo ? MSG.issues.hum.dry : MSG.issues.hum.humid;
      if (s.id === 'gas') msg = level === 'danger' ? MSG.issues.gas.danger : MSG.issues.gas.warn;
    }
    return { sensor: s.id, level, msg };
  });
}

function buildRecommendations(reading) {
  const recs = [];
  const t = Number(reading.temperature);
  const h = Number(reading.humidity);
  const g = Number(reading.gas_ppm);
  const T = THRESHOLDS;

  if (Number.isFinite(g)) {
    if (g > T.gas.critical) recs.push({ level: 'danger', text: fill(MSG.recommendations.gasCritical, { v: g.toFixed(0) }) });
    else if (g > T.gas.danger) recs.push({ level: 'danger', text: fill(MSG.recommendations.gasDanger, { v: g.toFixed(0) }) });
    else if (g > T.gas.warn) recs.push({ level: 'warning', text: fill(MSG.recommendations.gasWarn, { v: g.toFixed(0) }) });
  }
  if (Number.isFinite(t)) {
    if (t < T.temp.okLo) recs.push({ level: t < T.temp.warnLo ? 'danger' : 'warning', text: fill(MSG.recommendations.tempCold, { v: t.toFixed(1) }) });
    else if (t > T.temp.okHi) recs.push({ level: t > T.temp.warnHi ? 'danger' : 'warning', text: fill(MSG.recommendations.tempHot, { v: t.toFixed(1) }) });
  }
  if (Number.isFinite(h)) {
    if (h < T.hum.okLo) recs.push({ level: h < T.hum.warnLo ? 'danger' : 'warning', text: fill(MSG.recommendations.humDry, { v: h.toFixed(1) }) });
    else if (h > T.hum.okHi) recs.push({ level: h > T.hum.warnHi ? 'danger' : 'warning', text: fill(MSG.recommendations.humHigh, { v: h.toFixed(1) }) });
  }
  if (!recs.length) recs.push({ level: 'ok', text: MSG.recommendations.allOk });
  return recs;
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

/** One-line Thai summary of a reading (chat fallback / prompts). */
export function readingSummary(reading) {
  if (!reading) return MSG.chat.noData;
  return fill(MSG.summary, {
    t: Number(reading.temperature ?? 0).toFixed(1),
    h: Number(reading.humidity ?? 0).toFixed(1),
    g: Number(reading.gas_ppm ?? 0).toFixed(0),
    s: healthScore(reading),
  });
}
