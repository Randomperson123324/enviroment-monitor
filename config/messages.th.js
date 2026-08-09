/**
 * Thai message templates used by the analysis engine and API fallbacks.
 * Centralized so wording changes never require touching logic.
 */

export const MSG = {
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
    gas: {
      warn: 'ก๊าซเริ่มสูง',
      danger: 'ก๊าซสูงอันตราย',
      ok: 'ปกติ',
    },
  },

  recommendations: {
    tempCold: 'อุณหภูมิต่ำ ({v}°C) — ปิดแอร์/เพิ่มความอบอุ่นในห้อง',
    tempHot: 'อุณหภูมิสูง ({v}°C) — เปิดแอร์หรือพัดลมช่วยระบายความร้อน',
    humDry: 'อากาศแห้ง ({v}%) — วางแก้วน้ำ/เครื่องเพิ่มความชื้นช่วยได้',
    humHigh: 'ความชื้นสูง ({v}%) — เปิดพัดลมระบายอากาศ ลดความอับชื้น',
    gasWarn: 'ค่าก๊าซ {v} ppm เริ่มสูง — เปิดหน้าต่างระบายอากาศ',
    gasDanger: 'ค่าก๊าซ {v} ppm สูงอันตราย — ระบายอากาศทันทีและหาแหล่งที่มา',
    gasCritical: 'ค่าก๊าซ {v} ppm วิกฤต — ออกจากห้องทันที!',
    allOk: 'สภาพแวดล้อมเหมาะสม รักษาระดับนี้ต่อไป',
  },

  alerts: {
    gasHigh: '⚠️ GAS HIGH ({v}ppm) — เปิดหน้าต่างระบายอากาศ',
    gasCritical: '☣️ GAS CRITICAL ({v}ppm) — ออกจากห้องทันที!',
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

  summary: 'อุณหภูมิ {t}°C ความชื้น {h}% ก๊าซ {g} ppm คะแนนสุขภาพห้อง {s}/100',
};

/** Tiny template helper: fill('{v} ppm', {v: 42}) → '42 ppm' */
export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}
