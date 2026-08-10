/**
 * Environmental disease-risk rules — which illnesses spread more readily
 * under the current temperature / humidity / air-quality conditions.
 *
 * Each rule maps a reading to a risk level (`warning` | `danger` | '') via a
 * pure `level(reading)` function, and carries i18n keys for its name / prevention
 * plus a `reason(reading)` returning `{ key, vars }` so the wording is translated
 * at render time (see config/i18n.js `disease.*`). Thresholds reuse
 * config/sensors.js so nothing is duplicated. Sources are reputable public-health
 * bodies (WHO, CDC, EPA, Thai DDC) — every surfaced risk links to one.
 */
import { THRESHOLDS, risingLevel } from '@/config/sensors';

const num = (v) => Number(v);
const has = (v) => v != null && Number.isFinite(Number(v));

const LEVEL_RANK = { '': 0, warning: 1, danger: 2 };

/**
 * Which airborne pollutant drives the respiratory risk, with the reason wording
 * that matches it. PM2.5 wins a tie: it is a calibrated µg/m³ measurement of the
 * particles that reach the alveoli, whereas the MQ-2 is an uncalibrated proxy.
 */
function airborneRisk(r) {
  const gas = {
    level: risingLevel(num(r.gas_ppm), THRESHOLDS.gas),
    reason: { key: 'disease.respiratory.reason', vars: { g: num(r.gas_ppm).toFixed(0) } },
  };
  if (!has(r.pm25)) return gas;
  const pm = {
    level: risingLevel(num(r.pm25), THRESHOLDS.pm25),
    reason: {
      key: 'disease.respiratory.reasonPm',
      vars: { p: num(r.pm25).toFixed(0), std: THRESHOLDS.pm25.danger },
    },
  };
  return LEVEL_RANK[pm.level] >= LEVEL_RANK[gas.level] ? pm : gas;
}

export const SOURCES = {
  whoMould: {
    name: 'WHO — Guidelines for indoor air quality: dampness and mould',
    url: 'https://www.who.int/publications/i/item/9789289041683',
  },
  whoAir: {
    name: 'WHO — Ambient (outdoor) air pollution',
    url: 'https://www.who.int/news-room/fact-sheets/detail/ambient-(outdoor)-air-quality-and-health',
  },
  cdcMold: {
    name: 'CDC — Mold and Your Health',
    url: 'https://www.cdc.gov/mold-health/about/',
  },
  cdcFlu: {
    name: 'CDC — How Flu Spreads',
    url: 'https://www.cdc.gov/flu/spread/',
  },
  cdcHeat: {
    name: 'CDC — Heat and Your Health',
    url: 'https://www.cdc.gov/heat-health/about/',
  },
  epaDustMite: {
    name: 'EPA — Care for Your Air: Dust Mites & Biological Pollutants',
    url: 'https://www.epa.gov/indoor-air-quality-iaq/biological-pollutants-impact-indoor-air-quality',
  },
  ddcThai: {
    name: 'กรมควบคุมโรค กระทรวงสาธารณสุข',
    url: 'https://ddc.moph.go.th/',
  },
};

/** Highest level wins when a rule can be both warning and danger. */
export const DISEASES = [
  {
    id: 'mould',
    nameKey: 'disease.mould.name',
    level: (r) => {
      const h = num(r.humidity);
      if (!has(h)) return '';
      if (h > THRESHOLDS.hum.warnHi) return 'danger';
      if (h > THRESHOLDS.hum.okHi) return 'warning';
      return '';
    },
    reason: (r) => ({
      key: 'disease.mould.reason',
      vars: { h: num(r.humidity).toFixed(0), okHi: THRESHOLDS.hum.okHi },
    }),
    preventionKey: 'disease.mould.prevention',
    source: SOURCES.whoMould,
  },
  {
    id: 'flu',
    nameKey: 'disease.flu.name',
    level: (r) => {
      const h = num(r.humidity);
      const t = num(r.temperature);
      if (has(h) && h < THRESHOLDS.hum.okLo) return h < THRESHOLDS.hum.warnLo ? 'danger' : 'warning';
      if (has(t) && t < THRESHOLDS.temp.okLo) return 'warning';
      return '';
    },
    reason: (r) => ({ key: 'disease.flu.reason', vars: { h: num(r.humidity).toFixed(0) } }),
    preventionKey: 'disease.flu.prevention',
    source: SOURCES.cdcFlu,
  },
  {
    id: 'dustmite',
    nameKey: 'disease.dustmite.name',
    level: (r) => {
      const h = num(r.humidity);
      const t = num(r.temperature);
      if (has(h) && has(t) && h > 60 && t > 25) return h > THRESHOLDS.hum.okHi ? 'danger' : 'warning';
      return '';
    },
    reason: () => ({ key: 'disease.dustmite.reason' }),
    preventionKey: 'disease.dustmite.prevention',
    source: SOURCES.epaDustMite,
  },
  {
    id: 'heat',
    nameKey: 'disease.heat.name',
    level: (r) => {
      const t = num(r.temperature);
      if (!has(t)) return '';
      if (t > THRESHOLDS.temp.warnHi) return 'danger';
      if (t > THRESHOLDS.temp.okHi) return 'warning';
      return '';
    },
    reason: (r) => ({ key: 'disease.heat.reason', vars: { t: num(r.temperature).toFixed(1) } }),
    preventionKey: 'disease.heat.prevention',
    source: SOURCES.cdcHeat,
  },
  {
    id: 'respiratory',
    nameKey: 'disease.respiratory.name',
    level: (r) => airborneRisk(r).level,
    reason: (r) => airborneRisk(r).reason,
    preventionKey: 'disease.respiratory.prevention',
    source: SOURCES.whoAir,
  },
  {
    id: 'bacteria',
    nameKey: 'disease.bacteria.name',
    level: (r) => {
      const t = num(r.temperature);
      const h = num(r.humidity);
      if (has(t) && has(h) && t > THRESHOLDS.temp.okHi && h > THRESHOLDS.hum.okHi) return 'warning';
      return '';
    },
    reason: () => ({ key: 'disease.bacteria.reason' }),
    preventionKey: 'disease.bacteria.prevention',
    source: SOURCES.ddcThai,
  },
];
