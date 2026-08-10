/**
 * Thai message templates used by the analysis engine and API fallbacks.
 * Centralized so wording changes never require touching logic.
 */

export const MSG = {
  /**
   * Keyed by sensor id, then by the key its `issueKey(v)` returns
   * (config/sensors.js) — the analysis engine never picks wording by id.
   */
  issues: {
    temp: {
      cold: 'อุณหภูมิต่ำ',
      hot: 'อุณหภูมิสูง',
      ok: 'ปกติ',
    },
    hum: {
      dry: 'อากาศแห้ง',
      humid: 'ความชื้นสูง',
      ok: 'ปกติ',
    },
    pm1: {
      warn: 'ฝุ่นละเอียด PM1 เริ่มสูง',
      danger: 'ฝุ่นละเอียด PM1 สูง',
      ok: 'ปกติ',
    },
    pm25: {
      warn: 'PM2.5 เริ่มสูง',
      danger: 'PM2.5 เกินมาตรฐาน',
      ok: 'ปกติ',
    },
    pm10: {
      warn: 'PM10 เริ่มสูง',
      danger: 'PM10 เกินมาตรฐาน',
      ok: 'ปกติ',
    },
  },

  /** Same shape as `issues`, keyed by what each sensor's `advice(v)` returns. */
  recommendations: {
    temp: {
      cold: 'อุณหภูมิต่ำ ({v}°C) — ปิดแอร์/เพิ่มความอบอุ่นในห้อง',
      hot: 'อุณหภูมิสูง ({v}°C) — เปิดแอร์หรือพัดลมช่วยระบายความร้อน',
    },
    hum: {
      dry: 'อากาศแห้ง ({v}%) — วางแก้วน้ำ/เครื่องเพิ่มความชื้นช่วยได้',
      humid: 'ความชื้นสูง ({v}%) — เปิดพัดลมระบายอากาศ ลดความอับชื้น',
    },
    pm25: {
      warn: 'PM2.5 {v} µg/m³ เริ่มสูง — ปิดหน้าต่างด้านถนนและเปิดเครื่องฟอกอากาศ',
      danger:
        'PM2.5 {v} µg/m³ เกินมาตรฐาน 24 ชม. ({std}) — เปิดเครื่องฟอกอากาศ ปิดช่องอากาศจากภายนอก เลี่ยงออกกำลังกายในห้อง',
      critical:
        'PM2.5 {v} µg/m³ สูงมาก — ใส่หน้ากาก N95 ถ้าต้องอยู่ในห้องนี้ และหาต้นตอฝุ่น (ธูป ควัน การทำอาหาร)',
    },
    pm10: {
      warn: 'PM10 {v} µg/m³ เริ่มสูง — เลี่ยงการกวาดฝุ่นแห้ง ใช้ผ้าชุบน้ำเช็ดแทน',
      danger: 'PM10 {v} µg/m³ เกินมาตรฐาน 24 ชม. ({std}) — เปิดเครื่องฟอกอากาศและปิดช่องอากาศจากภายนอก',
      critical: 'PM10 {v} µg/m³ สูงมาก — ใส่หน้ากากและระบายฝุ่นออกจากห้องก่อนใช้งานต่อ',
    },
    allOk: 'สภาพแวดล้อมเหมาะสม รักษาระดับนี้ต่อไป',
  },

  alerts: {
    pmHigh: 'PM2.5 {v} µg/m³ เกินมาตรฐาน — เปิดเครื่องฟอกอากาศ ปิดช่องอากาศจากภายนอก',
    pmCritical: 'PM2.5 {v} µg/m³ สูงมาก — ใส่หน้ากาก N95 และหาต้นตอฝุ่นทันที',
  },

  chat: {
    noKey:
      'ยังไม่มีผู้ให้บริการ AI ที่ใช้งานได้ — ตอนนี้ตอบได้เฉพาะสรุปค่าล่าสุด: {summary}',
    context:
      'คุณคือผู้ช่วยวิเคราะห์สภาพแวดล้อมในห้อง ตอบภาษาไทยแบบกระชับ อิงข้อมูลเซ็นเซอร์ล่าสุดต่อไปนี้',
    noData: 'ยังไม่มีข้อมูลเซ็นเซอร์ในระบบ',
  },

  analyze: {
    prompt:
      'วิเคราะห์สภาพแวดล้อมห้องจากข้อมูลเซ็นเซอร์นี้ แล้วตอบเป็น JSON เท่านั้น รูปแบบ {"summary": "สรุปสั้น 1 ประโยคภาษาไทย", "recommendations": [{"level": "ok|info|warning|danger", "text": "คำแนะนำภาษาไทย"}]} ให้คำแนะนำไม่เกิน {maxRecs} ข้อ',
    maxRecs: 4,
  },

  /**
   * One-line reading summary, assembled by readingSummary(): `pm` is dropped
   * when the device has no particulate sensor, so old rows read as before.
   */
  summary: {
    climate: 'อุณหภูมิ {t}°C ความชื้น {h}%',
    pm: 'PM1 {p1} PM2.5 {p25} PM10 {p10} µg/m³',
    score: 'คะแนนสุขภาพห้อง {s}/100',
  },

  /**
   * Per-tab summary prompts. Each asks for the same JSON shape as MSG.analyze so
   * the UI renders one component everywhere; only the framing differs.
   */
  scopes: {
    jsonShape:
      'ตอบเป็น JSON เท่านั้น รูปแบบ {"summary": "สรุปสั้น 1-2 ประโยคภาษาไทย", "recommendations": [{"level": "ok|info|warning|danger", "text": "คำแนะนำภาษาไทย"}]} ให้คำแนะนำไม่เกิน {maxRecs} ข้อ ห้ามแต่งตัวเลขที่ไม่มีในข้อมูล',
    environment:
      'คุณคือผู้ช่วยวิเคราะห์สภาพแวดล้อมในห้อง สรุปภาพรวมของห้องจากค่าเซ็นเซอร์ล่าสุดและแนวโน้มย้อนหลัง ชี้จุดที่ควรแก้ก่อน',
    focus:
      'คุณคือผู้ช่วยวิเคราะห์สมาธิและการจดจ่อจากกล้อง สรุปพฤติกรรมการเคลื่อนไหวของแต่ละบุคคลจากข้อมูลกล้อง บอกว่าใครขยับมากผิดปกติและช่วงเวลาใดที่เสียสมาธิ',
    hydro:
      'คุณคือผู้ช่วยด้านความปลอดภัยและสุขภาพ สรุปสถานการณ์น้ำ/สภาพอากาศจากหน่วยงานรัฐ ร่วมกับความเสี่ยงโรคที่มาจากสภาพห้อง บอกสิ่งที่ควรเฝ้าระวัง',
    noData: 'ยังไม่มีข้อมูลเพียงพอสำหรับสรุปในหมวดนี้',
  },
};

/** Tiny template helper: fill('{v} ppm', {v: 42}) → '42 ppm' */
export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}
