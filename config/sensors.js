/**
 * Sensor definitions — shared by server (scoring/analysis) and client (tiles/badges/charts).
 * Every threshold lives here; nothing threshold-like may appear inline elsewhere.
 * Wording lives in config/i18n.js (`sensor.<id>.*`) and config/messages.th.js —
 * never duplicated here. Safe for the browser: contains no secrets.
 *
 * A sensor comes in one of two threshold shapes, and every consumer (score,
 * issues, recommendations, tiles) works off the shape rather than the id, so
 * adding a sensor means adding an entry here and its strings — nothing else.
 *
 *   band   — two-sided comfort range (temp, humidity): okLo/okHi ideal band,
 *            warnLo/warnHi before it counts as dangerous.
 *   rising — one-sided "more is worse" (PM): clean → warn → danger → critical.
 */

/** Numeric thresholds per sensor (single place to tune). */
export const THRESHOLDS = {
  temp: { min: -10, max: 50, okLo: 20, okHi: 28, warnLo: 16, warnHi: 32 },
  hum: { min: 0, max: 100, okLo: 40, okHi: 65, warnLo: 25, warnHi: 75 },
  /**
   * Particulates in µg/m³ (PMS7003, atmospheric values). PM2.5/PM10 marks come
   * from the Thai 24-hour ambient standard in force 1 Jun 2023, with the WHO
   * AQG 2021 figure as `clean` — see docs/devices/pms7003.md §7.
   *
   * PM1 has no published standard: its marks are derived at ~0.7× the PM2.5
   * ones, the usual indoor PM1/PM2.5 mass ratio. They shape the tile only —
   * PM1 is deliberately left out of the score and the recommendations because
   * it is a subset of PM2.5 and would double-count the same dust.
   */
  pm1: { min: 0, max: 1000, clean: 10, warn: 18, danger: 26, critical: 52 },
  pm25: { min: 0, max: 1000, clean: 15, warn: 25, danger: 37.5, critical: 75 },
  pm10: { min: 0, max: 1000, clean: 45, warn: 120, danger: 180, critical: 300 },
  /**
   * Desk illuminance in lux (BH1750). The ideal band is the maintained
   * illuminance EN 12464-1 / ISO 8995-1 ask for at a workstation: 500 lx for
   * reading, writing and screen work, 300 lx for lighter tasks — so 300–750
   * covers a study desk without pretending to more precision than a single
   * sensor on one spot can give.
   *
   * Below 150 lx is corridor lighting: readable, but not for sustained work.
   * The high side is about screen glare and contrast, not danger to health —
   * a desk by a window legitimately reads past 2000 lx on a bright day, which
   * is why this sensor carries a smaller score penalty than temperature.
   */
  lux: { min: 0, max: 65535, okLo: 300, okHi: 750, warnLo: 150, warnHi: 2000 },
};

/**
 * Score penalties (points subtracted from 100) at warning / danger extremes.
 * A sensor without an entry here is reported but never scored.
 */
export const SCORE_PENALTY = {
  temp: { warn: 12, danger: 30 },
  hum: { warn: 10, danger: 24 },
  pm25: { warn: 15, danger: 35, critical: 60 },
  pm10: { warn: 8, danger: 20, critical: 40 },
  /**
   * Smaller than temperature on purpose. Bad lighting makes a room tiring to
   * study in, which is worth saying — but unlike heat or dust, being outside
   * the band is not a health risk, and the high end is often just daylight.
   */
  lux: { warn: 8, danger: 18 },
};

/**
 * PM thresholds are 24-hour ambient standards while the sensor reports every few
 * seconds, so comparing a single frame against them over-warns (pms7003.md §7).
 * The tiles therefore classify PM from a rolling mean over this many hours; the
 * displayed number stays the live reading.
 */
export const PM_AVG_HOURS = 1;

/** Level of a two-sided band sensor: '' | 'warning' | 'danger'. */
export function bandLevel(v, t) {
  if (v < t.warnLo || v > t.warnHi) return 'danger';
  if (v < t.okLo || v > t.okHi) return 'warning';
  return '';
}

/** Level of a one-sided rising sensor: '' | 'warning' | 'danger'. */
export function risingLevel(v, t) {
  if (v > t.danger) return 'danger';
  if (v > t.warn) return 'warning';
  return '';
}

/** i18n key suffix (`sensor.<id>.<key>`) for a rising sensor's badge. */
function risingTextKey(v, t) {
  if (v > t.critical) return 'crit';
  if (v > t.danger) return 'bad2';
  if (v > t.warn) return 'bad';
  if (v > t.clean) return 'okish';
  return 'ok';
}

/** MSG.issues.<id> key for a band sensor; `keys` names the low/high wording. */
function bandIssueKey(v, t, keys) {
  if (!bandLevel(v, t)) return 'ok';
  return v < t.okLo ? keys.lo : keys.hi;
}

/** MSG.recommendations.<id> key + severity for a band sensor, or null when fine. */
function bandAdvice(v, t, keys) {
  if (v < t.okLo) return { key: keys.lo, level: v < t.warnLo ? 'danger' : 'warning' };
  if (v > t.okHi) return { key: keys.hi, level: v > t.warnHi ? 'danger' : 'warning' };
  return null;
}

/**
 * One-sided sensor definition, shared by the three PM channels.
 * `advise: false` keeps a sensor out of the recommendation list (PM1 — same
 * action as PM2.5, so a second line would only repeat it).
 */
function risingSensor({ id, field, unit, dp, group, advise = true, avgHours = null }) {
  const t = THRESHOLDS[id];
  return {
    id,
    field,
    unit,
    dp,
    group,
    shape: 'rising',
    avgHours,
    range: [t.min, t.max],
    /** Visual range + healthy band for the tile gauge bar. */
    bar: { min: 0, max: Math.round(t.danger * 1.2), comfort: [0, t.clean] },
    level: (v) => risingLevel(v, t),
    textKey: (v) => risingTextKey(v, t),
    issueKey: (v) => {
      const level = risingLevel(v, t);
      return level === 'danger' ? 'danger' : level === 'warning' ? 'warn' : 'ok';
    },
    advice: (v) => {
      if (!advise) return null;
      if (v > t.critical) return { key: 'critical', level: 'danger' };
      if (v > t.danger) return { key: 'danger', level: 'danger' };
      if (v > t.warn) return { key: 'warn', level: 'warning' };
      return null;
    },
  };
}

export const SENSORS = [
  {
    id: 'temp',
    field: 'temperature',
    unit: '°C',
    dp: 1,
    group: 'climate',
    shape: 'band',
    avgHours: null,
    range: [THRESHOLDS.temp.min, THRESHOLDS.temp.max],
    bar: { min: 12, max: 38, comfort: [THRESHOLDS.temp.okLo, THRESHOLDS.temp.okHi] },
    level: (v) => bandLevel(v, THRESHOLDS.temp),
    textKey: (v) => {
      const t = THRESHOLDS.temp;
      if (v < t.warnLo) return 'cold2';
      if (v < t.okLo) return 'cold';
      if (v > t.warnHi) return 'hot2';
      if (v > t.okHi) return 'hot';
      return 'ok';
    },
    issueKey: (v) => bandIssueKey(v, THRESHOLDS.temp, { lo: 'cold', hi: 'hot' }),
    advice: (v) => bandAdvice(v, THRESHOLDS.temp, { lo: 'cold', hi: 'hot' }),
  },
  {
    id: 'hum',
    field: 'humidity',
    unit: '%',
    dp: 1,
    group: 'climate',
    shape: 'band',
    avgHours: null,
    range: [THRESHOLDS.hum.min, THRESHOLDS.hum.max],
    bar: { min: 10, max: 95, comfort: [THRESHOLDS.hum.okLo, THRESHOLDS.hum.okHi] },
    level: (v) => bandLevel(v, THRESHOLDS.hum),
    textKey: (v) => {
      const t = THRESHOLDS.hum;
      if (v < t.warnLo) return 'dry2';
      if (v < t.okLo) return 'dry';
      if (v > t.warnHi) return 'wet2';
      if (v > t.okHi) return 'wet';
      return 'ok';
    },
    issueKey: (v) => bandIssueKey(v, THRESHOLDS.hum, { lo: 'dry', hi: 'humid' }),
    advice: (v) => bandAdvice(v, THRESHOLDS.hum, { lo: 'dry', hi: 'humid' }),
  },
  // PM2.5 leads the dust group everywhere (tiles, chart legend, stats rows): it
  // is the channel with a health standard behind it, so it should not be read
  // last just because 1 < 2.5 < 10.
  risingSensor({ id: 'pm25', field: 'pm25', unit: 'µg/m³', dp: 0, group: 'pm', avgHours: PM_AVG_HOURS }),
  risingSensor({ id: 'pm10', field: 'pm10', unit: 'µg/m³', dp: 0, group: 'pm', avgHours: PM_AVG_HOURS }),
  risingSensor({ id: 'pm1', field: 'pm1', unit: 'µg/m³', dp: 0, group: 'pm', advise: false, avgHours: PM_AVG_HOURS }),
  {
    id: 'lux',
    field: 'lux',
    unit: 'lx',
    dp: 0,
    group: 'light',
    shape: 'band',
    avgHours: null,
    range: [THRESHOLDS.lux.min, THRESHOLDS.lux.max],
    // The bar stops at the glare threshold rather than the sensor's 65535
    // ceiling: on a 0–65535 bar every indoor reading would sit pinned to the
    // far left and the comfort band would be a hairline.
    bar: { min: 0, max: THRESHOLDS.lux.warnHi, comfort: [THRESHOLDS.lux.okLo, THRESHOLDS.lux.okHi] },
    level: (v) => bandLevel(v, THRESHOLDS.lux),
    textKey: (v) => {
      const t = THRESHOLDS.lux;
      if (v < t.warnLo) return 'dark2';
      if (v < t.okLo) return 'dark';
      if (v > t.warnHi) return 'bright2';
      if (v > t.okHi) return 'bright';
      return 'ok';
    },
    issueKey: (v) => bandIssueKey(v, THRESHOLDS.lux, { lo: 'dark', hi: 'bright' }),
    advice: (v) => bandAdvice(v, THRESHOLDS.lux, { lo: 'dark', hi: 'bright' }),
  },
];

/**
 * Tiles show everything except the PM channels, which rotate through one shared
 * tile of their own.
 */
export const MAIN_SENSORS = SENSORS.filter((s) => s.group !== 'pm');

/**
 * Chart split — one chart per unit family, so every line on a chart can share
 * an axis honestly instead of being scaled by an invented divisor.
 * Climate (°C 12–38, % 10–95) · PM (µg/m³) · light (lx, which reaches four
 * digits indoors and five in daylight — it would flatten the other two).
 */
export const CLIMATE_SENSORS = SENSORS.filter((s) => s.group === 'climate');
export const PM_SENSORS = SENSORS.filter((s) => s.group === 'pm');
export const LIGHT_SENSORS = SENSORS.filter((s) => s.group === 'light');

/** Health-score display bands (highest first). `id` keys UI palettes (ring color). */
export const SCORE_BANDS = [
  { id: 'excellent', min: 85, emoji: '😊', msg: 'สภาพแวดล้อมดีเยี่ยม เหมาะกับการทำงาน' },
  { id: 'good', min: 70, emoji: '🙂', msg: 'สภาพแวดล้อมดี มีจุดปรับปรุงเล็กน้อย' },
  { id: 'fair', min: 50, emoji: '😐', msg: 'สภาพแวดล้อมพอใช้ ควรปรับปรุงบางจุด' },
  { id: 'poor', min: 30, emoji: '😷', msg: 'สภาพแวดล้อมแย่ ควรแก้ไขโดยเร็ว' },
  { id: 'critical', min: 0, emoji: '🤢', msg: 'สภาพแวดล้อมอันตราย รีบแก้ไขทันที!' },
];

/**
 * Air-quality bands, read from PM2.5 (order matters: first match wins).
 *
 * These used to come from the MQ-2's ppm reading — an uncalibrated proxy for
 * "some gas is present". PM2.5 is a µg/m³ measurement against a published
 * standard, so the meter now says something checkable. `status` keys the shared
 * status palette; the same cutoffs drive the PM2.5 tile.
 */
export const AQI_SOURCE = 'pm25';

export const AQI_LEVELS = [
  { max: THRESHOLDS.pm25.clean, id: 'clean', status: 'good' },
  { max: THRESHOLDS.pm25.warn, id: 'moderate', status: 'warning' },
  { max: THRESHOLDS.pm25.danger, id: 'poor', status: 'serious' },
  { max: Infinity, id: 'danger', status: 'critical' },
];

/** Webcam (webcam_json) interpretation thresholds. */
export const WEBCAM = {
  /** Average eye-aspect-ratio below this = drowsy */
  drowsyEarBelow: 0.18,
  /** Blink rate per minute considered normal (display hint) */
  blinkNormal: [8, 21],
};

export function scoreBand(score) {
  return SCORE_BANDS.find((b) => score >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

export function aqiLevel(pm25) {
  return AQI_LEVELS.find((l) => pm25 <= l.max) ?? AQI_LEVELS[AQI_LEVELS.length - 1];
}
