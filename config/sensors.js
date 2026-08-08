/**
 * Sensor definitions — shared by server (scoring/analysis) and client (tiles/badges/charts).
 * Every threshold lives here; nothing threshold-like may appear inline elsewhere.
 * Safe for the browser: contains no secrets.
 */

/** Numeric thresholds per sensor (single place to tune). */
export const THRESHOLDS = {
  temp: { min: -10, max: 50, okLo: 20, okHi: 28, warnLo: 16, warnHi: 32 },
  hum: { min: 0, max: 100, okLo: 40, okHi: 65, warnLo: 25, warnHi: 75 },
  gas: { min: 0, max: 2000, clean: 80, warn: 150, danger: 300, critical: 600 },
};

/** Score penalties (points subtracted from 100) at warning / danger extremes. */
export const SCORE_PENALTY = {
  temp: { warn: 12, danger: 30 },
  hum: { warn: 10, danger: 24 },
  gas: { warn: 15, danger: 35, critical: 55 },
};

function rangeLevel(v, t) {
  if (v < t.warnLo || v > t.warnHi) return 'danger';
  if (v < t.okLo || v > t.okHi) return 'warning';
  return '';
}

export const SENSORS = [
  {
    id: 'temp',
    field: 'temperature',
    label: 'อุณหภูมิ',
    unit: '°C',
    dp: 1,
    range: [THRESHOLDS.temp.min, THRESHOLDS.temp.max],
    /** Visual range + healthy band for the tile gauge bar. */
    bar: { min: 12, max: 38, comfort: [THRESHOLDS.temp.okLo, THRESHOLDS.temp.okHi] },
    badge: 'TEMP',
    level: (v) => rangeLevel(v, THRESHOLDS.temp),
    text: (v) => {
      const t = THRESHOLDS.temp;
      if (v < t.warnLo) return 'เย็นจัด';
      if (v < t.okLo) return 'เย็น';
      if (v > t.warnHi) return 'ร้อนจัด';
      if (v > t.okHi) return 'ค่อนข้างร้อน';
      return 'สมบูรณ์';
    },
    /** i18n key suffix (see config/i18n.js `sensor.temp.*`). */
    textKey: (v) => {
      const t = THRESHOLDS.temp;
      if (v < t.warnLo) return 'cold2';
      if (v < t.okLo) return 'cold';
      if (v > t.warnHi) return 'hot2';
      if (v > t.okHi) return 'hot';
      return 'ok';
    },
    statLabel: 'อุณหภูมิ',
  },
  {
    id: 'hum',
    field: 'humidity',
    label: 'ความชื้น',
    unit: '%',
    dp: 1,
    range: [THRESHOLDS.hum.min, THRESHOLDS.hum.max],
    bar: { min: 10, max: 95, comfort: [THRESHOLDS.hum.okLo, THRESHOLDS.hum.okHi] },
    badge: 'HUMID',
    level: (v) => rangeLevel(v, THRESHOLDS.hum),
    text: (v) => {
      const t = THRESHOLDS.hum;
      if (v < t.warnLo) return 'แห้งมาก';
      if (v < t.okLo) return 'ค่อนข้างแห้ง';
      if (v > t.warnHi) return 'ชื้นเกิน';
      if (v > t.okHi) return 'ชื้น';
      return 'เหมาะสม';
    },
    textKey: (v) => {
      const t = THRESHOLDS.hum;
      if (v < t.warnLo) return 'dry2';
      if (v < t.okLo) return 'dry';
      if (v > t.warnHi) return 'wet2';
      if (v > t.okHi) return 'wet';
      return 'ok';
    },
    statLabel: 'ความชื้น',
  },
  {
    id: 'gas',
    field: 'gas_ppm',
    label: 'คุณภาพอากาศ (MQ2)',
    unit: 'ppm',
    dp: 0,
    range: [THRESHOLDS.gas.min, THRESHOLDS.gas.max],
    bar: { min: 0, max: Math.round(THRESHOLDS.gas.danger * 1.2), comfort: [0, THRESHOLDS.gas.clean] },
    badge: 'GAS',
    level: (v) => {
      const t = THRESHOLDS.gas;
      if (v > t.danger) return 'danger';
      if (v > t.warn) return 'warning';
      return '';
    },
    text: (v) => {
      const t = THRESHOLDS.gas;
      if (v > t.critical) return '⚠️ อันตราย';
      if (v > t.danger) return 'แย่มาก';
      if (v > t.warn) return 'ไม่ดี';
      if (v > t.clean) return 'พอใช้';
      return 'บริสุทธิ์';
    },
    textKey: (v) => {
      const t = THRESHOLDS.gas;
      if (v > t.critical) return 'crit';
      if (v > t.danger) return 'bad2';
      if (v > t.warn) return 'bad';
      if (v > t.clean) return 'okish';
      return 'ok';
    },
    statLabel: 'ก๊าซ',
  },
];

/** Health-score display bands (highest first). `id` keys UI palettes (ring color). */
export const SCORE_BANDS = [
  { id: 'excellent', min: 85, emoji: '😊', msg: 'สภาพแวดล้อมดีเยี่ยม เหมาะกับการทำงาน' },
  { id: 'good', min: 70, emoji: '🙂', msg: 'สภาพแวดล้อมดี มีจุดปรับปรุงเล็กน้อย' },
  { id: 'fair', min: 50, emoji: '😐', msg: 'สภาพแวดล้อมพอใช้ ควรปรับปรุงบางจุด' },
  { id: 'poor', min: 30, emoji: '😷', msg: 'สภาพแวดล้อมแย่ ควรแก้ไขโดยเร็ว' },
  { id: 'critical', min: 0, emoji: '🤢', msg: 'สภาพแวดล้อมอันตราย รีบแก้ไขทันที!' },
];

/** Air-quality index bands derived from gas ppm (order matters: first match wins). */
export const AQI_LEVELS = [
  { max: THRESHOLDS.gas.clean, id: 'clean', label: 'สะอาด', icon: '😊', status: 'good' },
  { max: THRESHOLDS.gas.warn, id: 'moderate', label: 'ปานกลาง', icon: '🙂', status: 'warning' },
  { max: THRESHOLDS.gas.danger, id: 'poor', label: 'แย่', icon: '😷', status: 'serious' },
  { max: Infinity, id: 'danger', label: 'อันตราย', icon: '☣️', status: 'critical' },
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

export function aqiLevel(gas) {
  return AQI_LEVELS.find((l) => gas <= l.max) ?? AQI_LEVELS[AQI_LEVELS.length - 1];
}
