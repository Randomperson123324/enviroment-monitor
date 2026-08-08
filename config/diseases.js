/**
 * Environmental disease-risk rules — which illnesses spread more readily
 * under the current temperature / humidity / air-quality conditions.
 *
 * Each rule maps a reading to a risk level (`warning` | `danger` | '') via a
 * pure `level(reading)` function, and carries a Thai reason, prevention tip,
 * and a citable source. Thresholds reuse config/sensors.js so nothing is
 * duplicated. Sources are reputable public-health bodies (WHO, CDC, EPA,
 * Thai DDC) — every surfaced risk links to one.
 */
import { THRESHOLDS } from '@/config/sensors';

const num = (v) => Number(v);
const has = (v) => v != null && Number.isFinite(Number(v));

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
    name: 'เชื้อราและโรคระบบทางเดินหายใจ',
    level: (r) => {
      const h = num(r.humidity);
      if (!has(h)) return '';
      if (h > THRESHOLDS.hum.warnHi) return 'danger';
      if (h > THRESHOLDS.hum.okHi) return 'warning';
      return '';
    },
    reason: (r) =>
      `ความชื้น ${num(r.humidity).toFixed(0)}% สูงเกินเหมาะสม เชื้อรามักเติบโตเมื่อความชื้น > ${THRESHOLDS.hum.okHi}% ก่อภูมิแพ้และการติดเชื้อทางเดินหายใจ`,
    prevention: 'เปิดพัดลมระบายอากาศ ลดความชื้น เช็ดผิวที่มีหยดน้ำเกาะ',
    source: SOURCES.whoMould,
  },
  {
    id: 'flu',
    name: 'ไข้หวัดและไข้หวัดใหญ่',
    level: (r) => {
      const h = num(r.humidity);
      const t = num(r.temperature);
      if (has(h) && h < THRESHOLDS.hum.okLo) return h < THRESHOLDS.hum.warnLo ? 'danger' : 'warning';
      if (has(t) && t < THRESHOLDS.temp.okLo) return 'warning';
      return '';
    },
    reason: (r) =>
      `อากาศแห้ง (ความชื้น ${num(r.humidity).toFixed(0)}%) ทำให้ไวรัสไข้หวัดลอยในอากาศได้นานและเยื่อบุจมูกแห้ง เพิ่มโอกาสติดเชื้อ`,
    prevention: 'เพิ่มความชื้นในห้อง ดื่มน้ำให้เพียงพอ ล้างมือบ่อยๆ',
    source: SOURCES.cdcFlu,
  },
  {
    id: 'dustmite',
    name: 'ภูมิแพ้จากไรฝุ่น',
    level: (r) => {
      const h = num(r.humidity);
      const t = num(r.temperature);
      if (has(h) && has(t) && h > 60 && t > 25) return h > THRESHOLDS.hum.okHi ? 'danger' : 'warning';
      return '';
    },
    reason: () =>
      'อุณหภูมิอบอุ่นร่วมกับความชื้นสูงเป็นสภาพที่ไรฝุ่นขยายพันธุ์ได้ดี กระตุ้นอาการภูมิแพ้และหอบหืด',
    prevention: 'ควบคุมความชื้นให้ต่ำกว่า 60% ซักผ้าปูที่นอนด้วยน้ำร้อนเป็นประจำ',
    source: SOURCES.epaDustMite,
  },
  {
    id: 'heat',
    name: 'โรคจากความร้อน / เพลียแดด',
    level: (r) => {
      const t = num(r.temperature);
      if (!has(t)) return '';
      if (t > THRESHOLDS.temp.warnHi) return 'danger';
      if (t > THRESHOLDS.temp.okHi) return 'warning';
      return '';
    },
    reason: (r) =>
      `อุณหภูมิ ${num(r.temperature).toFixed(1)}°C สูงเกินเกณฑ์สบาย เสี่ยงต่อภาวะขาดน้ำ เพลียแดด และโรคลมแดดหากอยู่นาน`,
    prevention: 'ดื่มน้ำบ่อยๆ เปิดเครื่องปรับอากาศหรือพัดลม หลีกเลี่ยงการออกแรงหนัก',
    source: SOURCES.cdcHeat,
  },
  {
    id: 'respiratory',
    name: 'การระคายเคืองทางเดินหายใจ / หอบหืด',
    level: (r) => {
      const g = num(r.gas_ppm);
      if (!has(g)) return '';
      if (g > THRESHOLDS.gas.danger) return 'danger';
      if (g > THRESHOLDS.gas.warn) return 'warning';
      return '';
    },
    reason: (r) =>
      `ค่าก๊าซ/ฝุ่น ${num(r.gas_ppm).toFixed(0)} ppm สูง อาจระคายเคืองทางเดินหายใจ กระตุ้นหอบหืดและหลอดลมอักเสบ`,
    prevention: 'เปิดหน้าต่างระบายอากาศ หาแหล่งที่มาของก๊าซ ใช้เครื่องฟอกอากาศ',
    source: SOURCES.whoAir,
  },
  {
    id: 'bacteria',
    name: 'การเจริญของแบคทีเรีย / อาหารเป็นพิษ',
    level: (r) => {
      const t = num(r.temperature);
      const h = num(r.humidity);
      if (has(t) && has(h) && t > THRESHOLDS.temp.okHi && h > THRESHOLDS.hum.okHi) return 'warning';
      return '';
    },
    reason: () =>
      'อากาศร้อนชื้นเร่งการเจริญเติบโตของแบคทีเรียบนอาหารและพื้นผิว เพิ่มความเสี่ยงอาหารเป็นพิษ',
    prevention: 'เก็บอาหารในตู้เย็น ทำความสะอาดพื้นผิว ไม่วางอาหารทิ้งไว้นาน',
    source: SOURCES.ddcThai,
  },
];

export const DISEASE_ALL_CLEAR = {
  title: 'สภาพแวดล้อมไม่เอื้อต่อการแพร่ของโรค',
  detail: 'อุณหภูมิ ความชื้น และคุณภาพอากาศอยู่ในเกณฑ์ปลอดภัย ความเสี่ยงต่อโรคจากสิ่งแวดล้อมต่ำ',
};
