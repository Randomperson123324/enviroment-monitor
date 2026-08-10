/**
 * UI string catalogue for the two supported languages (Thai default, English).
 *
 * Keys are dotted paths (`sensor.temp.label`). Templates take `{vars}` filled by
 * `translate(lang, key, vars)`. Only client-rendered *chrome* lives here — text
 * generated server-side (AI analysis/recommendations, chat replies) and values
 * that arrive from the government feeds stay in whatever language the source
 * produced them, since a client toggle can't re-translate them.
 */

export const LANGS = ['th', 'en'];

const DICT = {
  th: {
    lang: { toggle: 'EN', label: 'ภาษา' },

    header: {
      brandSub: 'ดูแลสภาพแวดล้อมห้องของคุณ',
      menu: 'เมนู',
      device: 'อุปกรณ์',
      selectDevice: 'เลือกอุปกรณ์',
      noData: '— รอข้อมูล —',
      refresh: 'รีเฟรชข้อมูล',
      settings: 'ตั้งค่า',
      help: 'คีย์ลัดและวิธีใช้',
      toggleTheme: 'สลับโหมดสว่าง/มืด',
    },

    tabs: {
      menuLabel: 'เลือกหมวดข้อมูล',
      environment: 'สภาพแวดล้อม',
      focus: 'การจดจ่อ',
      hydro: 'ความปลอดภัยและสุขภาพ',
    },

    /** Relative ages — see lib/format.js ageParts() */
    age: {
      now: 'เมื่อสักครู่',
      min: '{n} นาทีที่แล้ว',
      hour: '{n} ชม.ที่แล้ว',
      day: '{n} วันที่แล้ว',
    },

    /** Bare durations for labels that add their own framing ("ออฟไลน์ {age}"). */
    ageShort: { now: 'ไม่ถึงนาที', min: '{n} นาที', hour: '{n} ชม.', day: '{n} วัน' },

    status: {
      live: 'ข้อมูลสด',
      stale: 'ค้าง {age}',
      offline: 'ออฟไลน์ {age}',
      none: 'ยังไม่มีข้อมูล',
      at: 'ข้อมูลล่าสุด {ts}',
      staleTag: 'ค่าเก่า',
      staleBanner: 'ข้อมูลล่าสุด {ts} ({age}) — ตัวเลขบนหน้านี้เป็นค่าเก่า ไม่ใช่สภาพห้องตอนนี้',
      offlineBanner: 'อุปกรณ์ไม่ส่งข้อมูลมา {age} — ค่าล่าสุดที่มีคือของวันที่ {ts} ทั้งหน้านี้จึงเป็นข้อมูลย้อนหลัง',
      noneBanner: 'ยังไม่เคยได้รับข้อมูลจากอุปกรณ์นี้ — ตรวจว่าอุปกรณ์ส่งเข้า POST /api/ingest แล้วหรือยัง',
      apiDown:
        'ติดต่อเซิร์ฟเวอร์ API ไม่ได้ ({base}) — {msg} · ตัวเลขบนหน้านี้ค้างอยู่ที่ค่าล่าสุดที่โหลดได้ ตรวจช่อง "ที่อยู่เซิร์ฟเวอร์ API" ในหน้าตั้งค่า (เว้นว่าง = เซิร์ฟเวอร์เดียวกับหน้าเว็บ)',
      apiSameOrigin: 'เซิร์ฟเวอร์เดียวกับหน้าเว็บ',
    },

    toast: {
      refreshed: 'อัปเดตข้อมูลแล้ว',
      refreshFailed: 'รีเฟรชไม่สำเร็จ: {msg}',
      saved: 'บันทึกการตั้งค่าแล้ว',
      logCleared: 'ล้างบันทึกระบบแล้ว',
      summaryRefreshed: 'สั่งสรุปใหม่แล้ว',
      dismiss: 'ปิดข้อความ',
    },

    shortcuts: {
      title: 'คีย์ลัด',
      meta: 'ใช้ได้ตอนที่ไม่ได้พิมพ์ในช่องกรอก',
      hint: 'กด ? เพื่อดูคีย์ลัด',
      hintKey: 'ดูคีย์ลัดทั้งหมด',
      goTab: 'ไปหมวด{name}',
      refresh: 'รีเฟรชข้อมูลเดี๋ยวนี้',
      ai: 'เปิดผู้ช่วย AI',
      settings: 'เปิดหน้าตั้งค่า',
      theme: 'สลับโหมดสว่าง/มืด',
      help: 'เปิด/ปิดรายการคีย์ลัด',
      close: 'ปิดหน้าต่างที่เปิดอยู่',
    },

    env: { statusNow: 'สถานะปัจจุบัน', deviceMeta: 'อุปกรณ์ {id}' },

    alert: {
      pmHigh: 'PM2.5 {v} µg/m³ เกินมาตรฐาน — เปิดเครื่องฟอกอากาศ ปิดช่องอากาศจากภายนอก',
      pmCritical: 'PM2.5 {v} µg/m³ สูงมาก — ใส่หน้ากาก N95 และหาต้นตอฝุ่นทันที',
    },

    overview: {
      scoreLabel: 'คะแนนสุขภาพห้อง',
      waiting: 'กำลังรอข้อมูลจากเซ็นเซอร์...',
      updated: 'อัปเดตล่าสุด: {ts}',
      connecting: '⏳ กำลังเชื่อมต่อ Arduino UNO Q',
    },

    sensor: {
      temp: { label: 'อุณหภูมิ', stat: 'อุณหภูมิ',
        cold2: 'เย็นจัด', cold: 'เย็น', hot2: 'ร้อนจัด', hot: 'ค่อนข้างร้อน', ok: 'สมบูรณ์' },
      hum: { label: 'ความชื้น', stat: 'ความชื้น',
        dry2: 'แห้งมาก', dry: 'ค่อนข้างแห้ง', wet2: 'ชื้นเกิน', wet: 'ชื้น', ok: 'เหมาะสม' },
      pm1: { label: 'ฝุ่น PM1', stat: 'PM1',
        crit: '⚠️ อันตราย', bad2: 'แย่มาก', bad: 'ไม่ดี', okish: 'พอใช้', ok: 'สะอาด' },
      pm25: { label: 'ฝุ่น PM2.5', stat: 'PM2.5',
        crit: '⚠️ อันตราย', bad2: 'แย่มาก', bad: 'เกินมาตรฐาน', okish: 'พอใช้', ok: 'สะอาด' },
      pm10: { label: 'ฝุ่น PM10', stat: 'PM10',
        crit: '⚠️ อันตราย', bad2: 'แย่มาก', bad: 'เกินมาตรฐาน', okish: 'พอใช้', ok: 'สะอาด' },
      air: {
        label: 'คุณภาพอากาศ',
        show: 'แสดง{label}',
      },
      tile: {
        barTitle: 'แถบแสดงค่าปัจจุบันเทียบกับช่วงที่เหมาะสม',
        comfortStart: 'ช่วงเหมาะสมเริ่ม {v} {unit}',
        comfortEnd: 'ช่วงเหมาะสมสิ้นสุด {v} {unit}',
        comfort: 'เหมาะสม {lo}–{hi}',
        waiting: 'รอข้อมูล',
        avgWindow: 'ระดับตัดสินจากค่าเฉลี่ย {h} ชม. (มาตรฐานฝุ่นเป็นค่าเฉลี่ย ไม่ใช่ค่าชั่วขณะ)',
      },
    },

    charts: {
      title: 'แนวโน้มย้อนหลัง',
      meta: '{range} · {n} จุดข้อมูล',
      timeRange: 'ช่วงเวลา',
      smoothing: 'ความลื่นของเส้นกราฟ',
      scoreTitle: 'คะแนนสุขภาพห้อง',
      avg: 'เฉลี่ย {v}',
      airQuality: 'เกณฑ์ PM2.5',
      pmTitle: 'ฝุ่นละออง PM (µg/m³)',
      pmMeta: 'ค่าที่วัดได้จริง · เกณฑ์เตือนใช้ค่าเฉลี่ย {h} ชม.',
      hoursShort: '{h} ชม.',
      series: '{label} ({unit})',
    },

    ranges: { '1': '1 ชม.', '6': '6 ชม.', '12': '12 ชม.', '24': '24 ชม.', '72': '3 วัน' },
    smooth: { raw: 'ดิบ', light: 'เบา', medium: 'กลาง', smooth: 'ลื่น' },
    aqi: { clean: 'สะอาด', moderate: 'ปานกลาง', poor: 'เกินมาตรฐาน', danger: 'อันตราย' },

    stats: {
      title: 'สรุปสถิติ',
      meta: 'จากข้อมูล {n} จุดในช่วงที่เลือก',
      scoreLabel: 'คะแนนสุขภาพห้อง',
      metric: 'ตัวชี้วัด', latest: 'ล่าสุด', min: 'ต่ำสุด', avg: 'เฉลี่ย', max: 'สูงสุด',
    },

    webcam: {
      noFace: 'ไม่พบใบหน้า', blinking: 'หลับตา', drowsy: 'ง่วง', awake: 'ลืมตา',
      below: 'ต่ำกว่าปกติ', above: 'สูงกว่าปกติ', normal: 'ปกติ',
      focusScore: 'คะแนนโฟกัส', fromCamera: 'วิเคราะห์จากกล้อง ({backend})',
      eyeState: 'สถานะดวงตา', blinkRate: 'อัตรากะพริบตา',
    },

    log: {
      collapse: 'ย่อบันทึกระบบ', expand: 'ขยายบันทึกระบบ', title: 'บันทึกระบบ',
      clear: 'ล้าง', refresh: 'รีเฟรช',
    },

    settings: {
      title: 'ตั้งค่า',
      apiBase: 'ที่อยู่เซิร์ฟเวอร์ API (เว้นว่าง = เซิร์ฟเวอร์เดียวกัน)',
      apiBasePlaceholder: 'เช่น http://192.168.1.50:3000 (ใส่ IP ดิบได้)',
      geminiKey: 'Gemini API Key (ไม่บังคับ — ใช้แทนของเซิร์ฟเวอร์)',
      geminiPlaceholder: 'เว้นว่างไว้เพื่อใช้ key ของเซิร์ฟเวอร์',
      ingestHintPre: 'อุปกรณ์ส่งข้อมูลเข้า',
      ingestHintMid: 'ด้วยค่าเหล่านี้ (ค่าที่อ่านไม่ได้ให้ส่ง null ห้ามส่ง 0):',
      pollSec: 'ความถี่อัปเดตข้อมูล (วินาที)',
      cancel: 'ยกเลิก', save: 'บันทึก',
      test: 'ทดสอบการเชื่อมต่อ',
      testing: 'กำลังทดสอบ...',
      testOk: 'เชื่อมต่อได้ · พบ {n} โมเดล',
      testEmpty: 'เชื่อมต่อได้ แต่ปลายทางไม่มีโมเดลให้ใช้',
      testFail: 'ไม่สำเร็จ: {msg}',
      apiTestOk: 'ใช้งานได้ · ต่อฐานข้อมูลได้',
      apiTestNoDb: 'เซิร์ฟเวอร์ตอบ แต่ต่อฐานข้อมูลไม่ได้',
      apiTestNotThisApp: 'ที่อยู่นี้ตอบกลับ แต่ไม่ใช่เซิร์ฟเวอร์ของแดชบอร์ดนี้',

      aiSection: 'ผู้ช่วย AI',
      aiSummaryStyle: 'รูปแบบการแสดงสรุปของ AI',
      aiSummaryStyleOpt: {
        blocks: 'แบบบล็อก (แยกกล่องตามระดับความสำคัญ)',
        markdown: 'แบบข้อความ (Markdown)',
      },
      aiSummaryStyleHint:
        'เปลี่ยนเฉพาะการแสดงผล ใช้ผลสรุปเดิมที่แคชไว้ ไม่ต้องเรียก AI ใหม่ · จำค่าไว้ในเบราว์เซอร์นี้',
      aiOrder: 'ลำดับการใช้ AI',
      aiOrderOpt: {
        server: 'ตามค่าเซิร์ฟเวอร์',
        localFirst: 'เครื่อง Local ก่อน → Gemini',
        geminiFirst: 'Gemini ก่อน → เครื่อง Local',
        localOnly: 'ใช้เครื่อง Local อย่างเดียว',
        geminiOnly: 'ใช้ Gemini อย่างเดียว',
      },
      aiServerOrder: 'ลำดับปัจจุบันของเซิร์ฟเวอร์: {order}',
      aiLocalBase: 'ที่อยู่ AI ในเครื่อง (OpenAI-compatible)',
      aiLocalModel: 'โมเดลของเครื่อง Local',
      aiGeminiBase: 'Gemini Base URL',
      aiGeminiModel: 'โมเดล Gemini',
      modelAuto: 'อัตโนมัติ (ตามที่เซิร์ฟเวอร์เลือก)',
      modelLoading: 'กำลังโหลดรายชื่อโมเดล...',
      modelStatus: { loaded: 'โหลดแล้ว', unloaded: 'ยังไม่โหลด' },
      aiRelay: 'ตัวกลาง (Relay) สำหรับเรียก AI',
      aiRelayServer: 'เซิร์ฟเวอร์ตั้งค่าไว้แล้ว',
      aiRelayHint:
        'ใส่ที่อยู่เว็บที่โฮสต์ไว้ เพื่อให้เครื่องนี้ส่งคำขอ AI ผ่านเครื่องนั้นแทน — ใช้ตอนเครือข่ายในงานเข้าถึง AI โดยตรงไม่ได้ เว้นว่าง = เรียกตรง',
    },

    ai: {
      title: 'ผู้ช่วย AI',
      local: 'ในเครื่อง',
      summaryTitle: 'สรุปโดย AI',
      viaRelay: '{name} (ผ่าน relay)',
      srcLocal: 'ในเครื่อง',
      greeting: 'สวัสดี — ถามเรื่องห้องนี้ได้เลย',
      chatEmpty1: 'ถามเกี่ยวกับสภาพแวดล้อมในห้อง',
      chatEmpty2: 'ข้อมูลเซ็นเซอร์จะถูกแนบไปอัตโนมัติ',
      chatPlaceholder: 'ถามเกี่ยวกับสภาพแวดล้อม...',
      send: 'ส่ง', close: 'ปิดผู้ช่วย AI', openAi: 'เปิดผู้ช่วย AI', dialog: 'ผู้ช่วย AI',
      dock: 'เข้าเทียบขอบขวา',
      undock: 'ดึงออกเป็นหน้าต่างลอย',
      resize: 'ลากเพื่อปรับขนาด',
      chatError: '⚠️ ขออภัย เกิดข้อผิดพลาด: {msg}',
    },

    aiSummary: {
      title: 'สรุปโดย AI',
      titleEnv: 'สรุปสภาพห้องโดย AI',
      titleFocus: 'สรุปการจดจ่อโดย AI (ประมวลผลในเครื่อง)',
      titleHydro: 'สรุปความปลอดภัยและสุขภาพโดย AI',
      loading: '✨ กำลังสรุป...',
      refresh: 'สรุปใหม่ตอนนี้',
      generatedAt: 'สรุปเมื่อ {time}',
      nextRefresh: 'จะสรุปใหม่อัตโนมัติเวลา {time}',
      failed: 'สรุปไม่สำเร็จ: {msg}',
      failedPinned: 'AI ในเครื่อง ({providers}) ใช้งานไม่ได้: {msg}',
      pinnedNote:
        'หมวดนี้ใช้ AI ในเครื่อง ({providers}) เท่านั้น จะไม่ส่งข้อมูลกล้องไปยัง Gemini หรือบริการภายนอก',
    },

    focus: {
      title: 'การจดจ่อจากกล้อง',
      thresholdPre: 'แจ้งเตือนเมื่อขยับเกิน', thresholdPost: 'ครั้ง/นาที',
      over: 'ขยับ {mv} ครั้ง/นาที — เกินที่กำหนดไว้ {th} ครั้ง!',
      chartTitle: 'การเคลื่อนไหวต่อนาที — แยกตามบุคคล (Face ID)',
      chartMeta: '{people} บุคคล · {mins} นาทีล่าสุด · แตะเส้นหรือ ID เพื่อดูรายละเอียด',
      waiting: '— รอข้อมูล —',
      empty: 'ยังไม่มีข้อมูลการตรวจจับ',
      emptyHint: 'กราฟนี้ใช้ข้อมูลจากบริการกล้องบน Pi (pi-vision) ที่เขียนลงตาราง focus ทุก 15 วินาที — ตรวจว่าบริการรันอยู่และกล้องไม่ถูกบัง',
      switchHint: 'แตะ 1-9 เพื่อสลับ · v / Esc เพื่อปิด',
      more: '+{n} อื่น ๆ',
      glossaryTitle: 'ความหมายของข้อมูล',
      detailTitle: 'รายละเอียด #{id}',
      detailHintTitle: 'รายละเอียดรายบุคคล',
      detailHint: 'แตะเส้นในกราฟ หรือแตะ ID ด้านล่างกราฟ เพื่อดูสถิติของบุคคลนั้น — การเคลื่อนไหวเฉลี่ย/สูงสุด และทิศทางที่หันล่าสุด',
      latestMove: 'การเคลื่อนไหวล่าสุด (ครั้ง/นาที) · เกณฑ์ {th}',
      avg: 'เฉลี่ย', max: 'สูงสุด', seen: 'ช่วงที่เห็น', faces: 'พบใบหน้า', mins: '{n} นาที',
      totalMove: 'การเคลื่อนไหวรวม / นาที',
      totalSub: 'รวมทุกคน 4 ช่วง × 15 วินาทีล่าสุด',
      thresholdInfo: 'เกณฑ์แจ้งเตือน: {th} ครั้ง/นาที',
      faceCount: 'จำนวนใบหน้า',
      faceWaiting: 'จำนวนใบหน้าที่ตรวจพบล่าสุด',
      faceNone: 'ไม่พบใบหน้า', faceOne: 'ตรวจพบ 1 คน', faceMany: 'ตรวจพบ {n} คน',
      normal: 'ปกติ', high: 'สูงเกิน!', chooseCam: 'เลือกกล้อง', scanning: 'scanning cameras…',
      closeDetail: 'ปิดรายละเอียด',
      tipMove: 'ขยับ {y} ครั้ง/นาที', tipDir: '↔ ซ้าย {l} ขวา {r} บน {u} ล่าง {d}',
      dirLeft: 'ซ้าย ←', dirRight: 'ขวา →', dirUp: 'บน ↑', dirDown: 'ล่าง ↓',
      gPerson: 'ID หน้าของบุคคลที่ตรวจจับ (Face ID) — ใช้ระบุว่าเป็นคนเดิมหรือไม่',
      gMovement: 'จำนวนครั้งที่หัวหัน/ขยับภายใน 15 วินาที — ค่าสูง = เสียสมาธิ',
      gDirection: 'ทิศทางที่หัน: Left / Right / Up / Down — ตัวเลขคือจำนวนครั้งต่อ 15s',
      gFaceCount: 'จำนวนใบหน้าที่ตรวจพบในกล้องขณะนั้น — >1 คน = มีคนอื่นในห้อง',
      gCreatedAt: 'เวลาที่บันทึก (ทุก 15 วินาที) — กราฟรวม 4 ช่วง = 1 นาที',
    },

    disease: {
      section: 'ความเสี่ยงโรคจากสภาพแวดล้อม',
      meta: 'วิเคราะห์จากอุณหภูมิ · ความชื้น · ฝุ่น PM2.5',
      heroDanger: 'มีความเสี่ยงต่อโรคสูง — ควรรีบปรับสภาพแวดล้อม',
      heroWarning: 'มีความเสี่ยงต่อโรคบางชนิด — ควรเฝ้าระวัง',
      heroClear: 'ความเสี่ยงต่อโรคจากสิ่งแวดล้อมต่ำ',
      waiting: 'กำลังรอข้อมูลเซ็นเซอร์...',
      needData: 'ต้องมีข้อมูลอุณหภูมิ ความชื้น หรือฝุ่น PM2.5 เพื่อประเมินความเสี่ยง',
      found: 'พบความเสี่ยง {n} รายการ',
      clearDetail: 'อุณหภูมิ ความชื้น และคุณภาพอากาศอยู่ในเกณฑ์ปลอดภัย ความเสี่ยงต่อโรคจากสิ่งแวดล้อมต่ำ',
      levelDanger: 'เสี่ยงสูง', levelWarning: 'เฝ้าระวัง', source: 'ที่มา: {name}',
      mould: { name: 'เชื้อราและโรคระบบทางเดินหายใจ',
        reason: 'ความชื้น {h}% สูงเกินเหมาะสม เชื้อรามักเติบโตเมื่อความชื้น > {okHi}% ก่อภูมิแพ้และการติดเชื้อทางเดินหายใจ',
        prevention: 'เปิดพัดลมระบายอากาศ ลดความชื้น เช็ดผิวที่มีหยดน้ำเกาะ' },
      flu: { name: 'ไข้หวัดและไข้หวัดใหญ่',
        reason: 'อากาศแห้ง (ความชื้น {h}%) ทำให้ไวรัสไข้หวัดลอยในอากาศได้นานและเยื่อบุจมูกแห้ง เพิ่มโอกาสติดเชื้อ',
        prevention: 'เพิ่มความชื้นในห้อง ดื่มน้ำให้เพียงพอ ล้างมือบ่อยๆ' },
      dustmite: { name: 'ภูมิแพ้จากไรฝุ่น',
        reason: 'อุณหภูมิอบอุ่นร่วมกับความชื้นสูงเป็นสภาพที่ไรฝุ่นขยายพันธุ์ได้ดี กระตุ้นอาการภูมิแพ้และหอบหืด',
        prevention: 'ควบคุมความชื้นให้ต่ำกว่า 60% ซักผ้าปูที่นอนด้วยน้ำร้อนเป็นประจำ' },
      heat: { name: 'โรคจากความร้อน / เพลียแดด',
        reason: 'อุณหภูมิ {t}°C สูงเกินเกณฑ์สบาย เสี่ยงต่อภาวะขาดน้ำ เพลียแดด และโรคลมแดดหากอยู่นาน',
        prevention: 'ดื่มน้ำบ่อยๆ เปิดเครื่องปรับอากาศหรือพัดลม หลีกเลี่ยงการออกแรงหนัก' },
      respiratory: { name: 'การระคายเคืองทางเดินหายใจ / หอบหืด',
        reasonPm: 'PM2.5 {p} µg/m³ เกินเกณฑ์ {std} µg/m³ ฝุ่นขนาดเล็กเข้าถึงถุงลมปอด กระตุ้นหอบหืดและหลอดลมอักเสบ',
        prevention: 'เปิดเครื่องฟอกอากาศ ปิดช่องอากาศจากภายนอก หาต้นตอฝุ่น (ธูป ควัน การทำอาหาร)' },
      bacteria: { name: 'การเจริญของแบคทีเรีย / อาหารเป็นพิษ',
        reason: 'อากาศร้อนชื้นเร่งการเจริญเติบโตของแบคทีเรียบนอาหารและพื้นผิว เพิ่มความเสี่ยงอาหารเป็นพิษ',
        prevention: 'เก็บอาหารในตู้เย็น ทำความสะอาดพื้นผิว ไม่วางอาหารทิ้งไว้นาน' },
    },

    hydro: {
      view: { water: 'ข้อมูลอุทกวิทยา', disease: 'ความเสี่ยงโรค' },
      viewLabel: 'เลือกข้อมูลที่จะแสดง',
      danger: 'มีจุดอันตราย {n} แห่ง — ระดับน้ำเกินเกณฑ์!',
      warning: 'มีจุดเฝ้าระวัง {n} แห่ง — ควรติดตามใกล้ชิด',
      normal: 'สถานการณ์น้ำปกติทุกจุดวัด',
      unknown: 'ยังไม่มีข้อมูลระดับน้ำล่าสุด',
      source: 'ข้อมูลจากเว็บ StreeFlood และหน่วยงานภาครัฐ',
      updatedAgo: ' · อัปเดต{ago}',
      refresh: 'รีเฟรชข้อมูลน้ำ',
      seeMore: 'ดูข้อมูลเพิ่มเติมที่ StreeFlood',
      chipTotal: 'จุดวัดทั้งหมด', chipDanger: 'อันตราย', chipWarning: 'เฝ้าระวัง',
      chipNoData: 'ไม่มีข้อมูลล่าสุด', chipRainWarn: 'ประกาศเตือนฝน',
      chipRainMax: 'ฝนสูงสุด 24 ชม.', chipOverCap: 'เขื่อนเกินความจุ',
      mm: 'มม.', feedFlood: 'น้ำท่วม', feedGov: 'ภาครัฐ',
    },

    flood: {
      title: 'ระดับน้ำจากระบบเตือนภัยน้ำท่วม',
      metaErr: 'เชื่อมต่อฐานข้อมูลน้ำท่วมไม่ได้ — แสดงข้อมูลล่าสุดที่มี',
      meta: '{n} จุดวัด · ข้อมูลจาก StreeFlood',
      empty: '⚠️ ยังเชื่อมต่อข้อมูลน้ำท่วมไม่ได้ — จะลองใหม่อัตโนมัติ',
      sevNormal: 'ปกติ', sevWarning: 'เฝ้าระวัง', sevDanger: 'อันตราย',
      trendRising: 'กำลังเพิ่มขึ้น', trendFalling: 'กำลังลดลง', trendStable: 'คงที่',
      noData: 'ไม่มีข้อมูล', stale: 'ข้อมูลเก่า',
      cm: 'ซม.', warnLevel: 'เตือน {v}', dangerLevel: 'อันตราย {v} ซม.',
      warnThresh: 'เกณฑ์เฝ้าระวัง {v} ซม.', dangerThresh: 'เกณฑ์อันตราย {v} ซม.',
      noReading: 'ยังไม่มีการวัดจากสถานีนี้',
      ratePerHour: '({v} ซม./ชม.)', pctOfDanger: '{pct}% ของเกณฑ์อันตราย',
    },

    gov: {
      title: 'ข้อมูลภาครัฐ (TMD · ThaiWater · กรมชลประทาน)',
      metaErr: 'เชื่อมต่อแหล่งข้อมูลภาครัฐไม่ได้ — แสดงข้อมูลล่าสุดที่มี',
      meta: 'ดึงตรงจากหน่วยงาน · อัปเดต{ago}',
      empty: '⚠️ ยังเชื่อมต่อแหล่งข้อมูลภาครัฐไม่ได้ — จะลองใหม่อัตโนมัติ',
      feedDown: 'ฟีดนี้ขัดข้องชั่วคราว',
      warnTitle: 'เตือนฝนตกหนัก / น้ำท่วมฉับพลัน',
      warnNone: 'ไม่มีประกาศเตือนขณะนี้',
      badgeFlash: 'น้ำท่วมฉับพลัน', badgeHeavyRain: 'ฝนตกหนัก',
      province: 'จ.',
      amphoe: 'อ.',
      warnVeryHeavy: 'ฝนตกหนักมาก',
      warnTotal: 'ทั้งหมด',
      bank: 'ของตลิ่ง',
      riverTitle: 'สถานการณ์แม่น้ำ',
      riverTotal: 'สถานีทั้งหมด', riverOverflow: 'ล้นตลิ่ง', riverHigh: 'น้ำมาก',
      badgeCritical: 'วิกฤต', riverNone: 'ไม่มีสถานีระดับวิกฤต',
      rainTitle: 'ฝนสะสม 24 ชม. สูงสุด', rainNone: 'ไม่มีข้อมูลฝนตกหนัก', mm: 'มม.',
      resTitle: 'อ่างเก็บน้ำ / เขื่อน',
      resTotal: 'ทั้งหมด', resOverCap: 'เกินความจุ', resHigh: 'น้ำมาก',
      annTitle: 'ประกาศ / พยากรณ์อากาศ (กรมอุตุนิยมวิทยา)',
      badgeAnn: 'ประกาศ', annRead: 'อ่านประกาศฉบับเต็ม',
    },
  },

  en: {
    lang: { toggle: 'ไทย', label: 'Language' },

    header: {
      brandSub: 'Keep your room environment healthy',
      menu: 'Menu',
      device: 'Device',
      selectDevice: 'Select device',
      noData: '— waiting —',
      refresh: 'Refresh data',
      settings: 'Settings',
      help: 'Shortcuts & help',
      toggleTheme: 'Toggle light/dark',
    },

    tabs: {
      menuLabel: 'Choose a data section',
      environment: 'Environment',
      focus: 'Focus',
      hydro: 'Safety & Health',
    },

    age: {
      now: 'just now',
      min: '{n} min ago',
      hour: '{n}h ago',
      day: '{n}d ago',
    },

    ageShort: { now: 'under a minute', min: '{n} min', hour: '{n}h', day: '{n}d' },

    status: {
      live: 'Live',
      stale: 'Stale · {age}',
      offline: 'Offline · {age}',
      none: 'No data yet',
      at: 'Last reading {ts}',
      staleTag: 'old value',
      staleBanner: 'Last reading {ts} ({age}) — the numbers on this page are old, not the room right now',
      offlineBanner: 'No data from this device for {age} — the newest reading is from {ts}, so this whole page is history',
      noneBanner: 'No reading has ever arrived from this device — check that it posts to POST /api/ingest',
      apiDown:
        'Cannot reach the API server ({base}) — {msg} · the numbers here are frozen at the last reading that loaded. Check the "API server URL" field in Settings (blank = the same server as this page).',
      apiSameOrigin: 'same server as this page',
    },

    toast: {
      refreshed: 'Data updated',
      refreshFailed: 'Refresh failed: {msg}',
      saved: 'Settings saved',
      logCleared: 'System log cleared',
      summaryRefreshed: 'Summary regenerating',
      dismiss: 'Dismiss',
    },

    shortcuts: {
      title: 'Keyboard shortcuts',
      meta: 'Active whenever you are not typing in a field',
      hint: 'Press ? for shortcuts',
      hintKey: 'all shortcuts',
      goTab: 'Go to {name}',
      refresh: 'Refresh data now',
      ai: 'Open the AI assistant',
      settings: 'Open settings',
      theme: 'Toggle light/dark',
      help: 'Show/hide this list',
      close: 'Close whatever is open',
    },

    env: { statusNow: 'Current status', deviceMeta: 'Device {id}' },

    alert: {
      pmHigh: 'PM2.5 {v} µg/m³ over standard — run a purifier and close outside air',
      pmCritical: 'PM2.5 {v} µg/m³ very high — wear an N95 and find the dust source now',
    },

    overview: {
      scoreLabel: 'Room health score',
      waiting: 'Waiting for sensor data...',
      updated: 'Last updated: {ts}',
      connecting: '⏳ Connecting to Arduino UNO Q',
    },

    sensor: {
      temp: { label: 'Temperature', stat: 'Temperature',
        cold2: 'Very cold', cold: 'Cold', hot2: 'Very hot', hot: 'Warm', ok: 'Ideal' },
      hum: { label: 'Humidity', stat: 'Humidity',
        dry2: 'Very dry', dry: 'Dry', wet2: 'Too humid', wet: 'Humid', ok: 'Ideal' },
      pm1: { label: 'PM1 dust', stat: 'PM1',
        crit: '⚠️ Dangerous', bad2: 'Very poor', bad: 'Poor', okish: 'Fair', ok: 'Clean' },
      pm25: { label: 'PM2.5 dust', stat: 'PM2.5',
        crit: '⚠️ Dangerous', bad2: 'Very poor', bad: 'Over standard', okish: 'Fair', ok: 'Clean' },
      pm10: { label: 'PM10 dust', stat: 'PM10',
        crit: '⚠️ Dangerous', bad2: 'Very poor', bad: 'Over standard', okish: 'Fair', ok: 'Clean' },
      air: {
        label: 'Air quality',
        show: 'Show {label}',
      },
      tile: {
        barTitle: 'Current value vs. the ideal band',
        comfortStart: 'Ideal band starts at {v} {unit}',
        comfortEnd: 'Ideal band ends at {v} {unit}',
        comfort: 'Ideal {lo}–{hi}',
        waiting: 'Waiting',
        avgWindow: 'Level judged on the {h}h rolling mean (dust standards are averages, not instant readings)',
      },
    },

    charts: {
      title: 'History trend',
      meta: '{range} · {n} data points',
      timeRange: 'Time range',
      smoothing: 'Line smoothing',
      scoreTitle: 'Room health score',
      avg: 'Avg {v}',
      airQuality: 'PM2.5 bands',
      pmTitle: 'Particulates PM (µg/m³)',
      pmMeta: 'Measured values · levels judged on the {h}h mean',
      hoursShort: '{h}h',
      series: '{label} ({unit})',
    },

    ranges: { '1': '1h', '6': '6h', '12': '12h', '24': '24h', '72': '3 days' },
    smooth: { raw: 'Raw', light: 'Light', medium: 'Medium', smooth: 'Smooth' },
    aqi: { clean: 'Clean', moderate: 'Moderate', poor: 'Over standard', danger: 'Dangerous' },

    stats: {
      title: 'Statistics summary',
      meta: 'From {n} data points in the selected range',
      scoreLabel: 'Room health score',
      metric: 'Metric', latest: 'Latest', min: 'Min', avg: 'Avg', max: 'Max',
    },

    webcam: {
      noFace: 'No face', blinking: 'Eyes closed', drowsy: 'Drowsy', awake: 'Eyes open',
      below: 'Below normal', above: 'Above normal', normal: 'Normal',
      focusScore: 'Focus score', fromCamera: 'From camera ({backend})',
      eyeState: 'Eye state', blinkRate: 'Blink rate',
    },

    log: {
      collapse: 'Collapse system log', expand: 'Expand system log', title: 'System log',
      clear: 'Clear', refresh: 'Refresh',
    },

    settings: {
      title: 'Settings',
      apiBase: 'API server URL (blank = same server)',
      apiBasePlaceholder: 'e.g. http://192.168.1.50:3000 (raw IP is fine)',
      geminiKey: 'Gemini API Key (optional — overrides the server key)',
      geminiPlaceholder: 'Leave blank to use the server key',
      ingestHintPre: 'Devices post data to',
      ingestHintMid: 'with these values (send null, never 0, for a sensor you cannot read):',
      pollSec: 'Data refresh interval (seconds)',
      cancel: 'Cancel', save: 'Save',
      test: 'Test connection',
      testing: 'Testing...',
      testOk: 'Reachable · {n} models',
      testEmpty: 'Reachable, but the endpoint offers no models',
      testFail: 'Failed: {msg}',
      apiTestOk: 'Working · database reachable',
      apiTestNoDb: 'Server answers, but cannot reach the database',
      apiTestNotThisApp: 'Something answers at this address, but it is not this dashboard',

      aiSection: 'AI assistant',
      aiSummaryStyle: 'AI summary style',
      aiSummaryStyleOpt: {
        blocks: 'Blocks (one card per recommendation, colour-coded)',
        markdown: 'Text (Markdown)',
      },
      aiSummaryStyleHint:
        'Presentation only — reuses the cached summary, so switching costs no AI call. Remembered in this browser.',
      aiOrder: 'Provider priority',
      aiOrderOpt: {
        server: 'Follow the server',
        localFirst: 'Local first → Gemini',
        geminiFirst: 'Gemini first → Local',
        localOnly: 'Local only',
        geminiOnly: 'Gemini only',
      },
      aiServerOrder: "Server's current order: {order}",
      aiLocalBase: 'Local AI endpoint (OpenAI-compatible)',
      aiLocalModel: 'Local model',
      aiGeminiBase: 'Gemini base URL',
      aiGeminiModel: 'Gemini model',
      modelAuto: 'Automatic (server picks)',
      modelLoading: 'Loading models...',
      modelStatus: { loaded: 'loaded', unloaded: 'not loaded' },
      aiRelay: 'AI relay',
      aiRelayServer: 'Already set on the server',
      aiRelayHint:
        'Point at your hosted deployment to send AI requests through it instead of calling providers directly — use it when the venue network cannot reach them. Blank = call directly.',
    },

    ai: {
      title: 'AI assistant',
      local: 'Local',
      summaryTitle: 'AI summary',
      viaRelay: '{name} (via relay)',
      srcLocal: 'local',
      greeting: 'Hi — ask me about this room',
      chatEmpty1: 'Ask about the room environment',
      chatEmpty2: 'Sensor data is attached automatically',
      chatPlaceholder: 'Ask about the environment...',
      send: 'Send', close: 'Close AI assistant', openAi: 'Open AI assistant', dialog: 'AI assistant',
      dock: 'Snap to the right edge',
      undock: 'Pull out into a floating window',
      resize: 'Drag to resize',
      chatError: '⚠️ Sorry, an error occurred: {msg}',
    },

    aiSummary: {
      title: 'AI summary',
      titleEnv: 'AI room summary',
      titleFocus: 'AI focus summary (on-device)',
      titleHydro: 'AI safety & health summary',
      loading: '✨ Summarizing...',
      refresh: 'Summarize again now',
      generatedAt: 'Summarized at {time}',
      nextRefresh: 'Refreshes automatically at {time}',
      failed: 'Summary failed: {msg}',
      failedPinned: 'On-device AI ({providers}) is unavailable: {msg}',
      pinnedNote:
        'This tab uses on-device AI ({providers}) only — camera data is never sent to Gemini or any external service.',
    },

    focus: {
      title: 'Camera focus',
      thresholdPre: 'Alert when movement exceeds', thresholdPost: 'times/min',
      over: 'Movement {mv}/min — over the {th} limit!',
      chartTitle: 'Movement per minute — by person (Face ID)',
      chartMeta: '{people} people · last {mins} min · tap a line or ID for details',
      waiting: '— waiting for data —',
      empty: 'No detections yet',
      emptyHint: 'This chart reads the camera service on the Pi (pi-vision), which writes to the focus table every 15 seconds — check that it is running and the lens is not covered',
      switchHint: 'press 1-9 to switch · v / Esc to close',
      more: '+{n} more',
      glossaryTitle: 'What the data means',
      detailTitle: 'Details #{id}',
      detailHintTitle: 'Per-person detail',
      detailHint: 'Tap a line in the chart, or an ID below it, to see that person’s stats — average/max movement and their latest facing direction.',
      latestMove: 'Latest movement (times/min) · limit {th}',
      avg: 'Avg', max: 'Max', seen: 'Seen for', faces: 'Faces', mins: '{n} min',
      totalMove: 'Total movement / min',
      totalSub: 'All people, last 4 × 15-second windows',
      thresholdInfo: 'Alert limit: {th} times/min',
      faceCount: 'Face count',
      faceWaiting: 'Latest number of faces detected',
      faceNone: 'No face detected', faceOne: '1 person detected', faceMany: '{n} people detected',
      normal: 'Normal', high: 'Too high!', chooseCam: 'choose camera', scanning: 'scanning cameras…',
      closeDetail: 'Close detail',
      tipMove: 'moved {y}/min', tipDir: '↔ L {l} R {r} U {u} D {d}',
      dirLeft: 'Left ←', dirRight: 'Right →', dirUp: 'Up ↑', dirDown: 'Down ↓',
      gPerson: 'Face ID of a detected person — tells whether it is the same person',
      gMovement: 'Head turns/movements within 15 seconds — high = distracted',
      gDirection: 'Facing direction: Left / Right / Up / Down — count per 15s',
      gFaceCount: 'Faces detected on camera at that moment — >1 = others in the room',
      gCreatedAt: 'Recorded time (every 15s) — chart bundles 4 windows = 1 minute',
    },

    disease: {
      section: 'Environmental disease risk',
      meta: 'Based on temperature · humidity · PM2.5',
      heroDanger: 'High disease risk — adjust the environment soon',
      heroWarning: 'Some disease risk — keep an eye on it',
      heroClear: 'Low environmental disease risk',
      waiting: 'Waiting for sensor data...',
      needData: 'Needs temperature, humidity, or PM2.5 data to assess risk',
      found: '{n} risks found',
      clearDetail: 'Temperature, humidity, and air quality are within safe ranges; environmental disease risk is low',
      levelDanger: 'High risk', levelWarning: 'Watch', source: 'Source: {name}',
      mould: { name: 'Mould & respiratory illness',
        reason: 'Humidity {h}% is above ideal; mould thrives above {okHi}%, causing allergies and respiratory infections',
        prevention: 'Run an exhaust fan, lower humidity, wipe down damp surfaces' },
      flu: { name: 'Cold & flu',
        reason: 'Dry air (humidity {h}%) lets flu virus linger and dries nasal passages, raising infection risk',
        prevention: 'Add humidity, drink enough water, wash hands often' },
      dustmite: { name: 'Dust-mite allergy',
        reason: 'Warm temperature plus high humidity lets dust mites breed, triggering allergies and asthma',
        prevention: 'Keep humidity below 60%, wash bedding in hot water regularly' },
      heat: { name: 'Heat illness / heat exhaustion',
        reason: 'Temperature {t}°C is above the comfort range, risking dehydration, exhaustion, and heatstroke if prolonged',
        prevention: 'Drink water often, use AC or a fan, avoid heavy exertion' },
      respiratory: { name: 'Airway irritation / asthma',
        reasonPm: 'PM2.5 {p} µg/m³ is above the {std} µg/m³ mark; fine particles reach the alveoli and trigger asthma and bronchitis',
        prevention: 'Run an air purifier, close outside air, find the dust source (incense, smoke, cooking)' },
      bacteria: { name: 'Bacterial growth / food poisoning',
        reason: 'Hot, humid air speeds bacterial growth on food and surfaces, raising food-poisoning risk',
        prevention: 'Refrigerate food, clean surfaces, don’t leave food out long' },
    },

    hydro: {
      view: { water: 'Hydrology', disease: 'Disease risk' },
      viewLabel: 'Choose what to show',
      danger: '{n} danger points — water level over threshold!',
      warning: '{n} watch points — monitor closely',
      normal: 'Water levels normal at every station',
      unknown: 'No recent water-level data yet',
      source: 'Data from StreeFlood and government agencies',
      updatedAgo: ' · updated {ago}',
      refresh: 'Refresh water data',
      seeMore: 'See more on StreeFlood',
      chipTotal: 'Total stations', chipDanger: 'Danger', chipWarning: 'Watch',
      chipNoData: 'No recent data', chipRainWarn: 'Rain warnings',
      chipRainMax: 'Max rain 24h', chipOverCap: 'Reservoirs over capacity',
      mm: 'mm', feedFlood: 'flood', feedGov: 'government',
    },

    flood: {
      title: 'Water levels from the flood warning system',
      metaErr: 'Cannot reach the flood database — showing the latest available data',
      meta: '{n} stations · data from StreeFlood',
      empty: '⚠️ Cannot reach flood data yet — retrying automatically',
      sevNormal: 'Normal', sevWarning: 'Watch', sevDanger: 'Danger',
      trendRising: 'Rising', trendFalling: 'Falling', trendStable: 'Stable',
      noData: 'No data', stale: 'Stale',
      cm: 'cm', warnLevel: 'Warn {v}', dangerLevel: 'Danger {v} cm',
      warnThresh: 'Warning threshold {v} cm', dangerThresh: 'Danger threshold {v} cm',
      noReading: 'No reading from this station yet',
      ratePerHour: '({v} cm/h)', pctOfDanger: '{pct}% of danger threshold',
    },

    gov: {
      title: 'Government data (TMD · ThaiWater · RID)',
      metaErr: 'Cannot reach government sources — showing the latest available data',
      meta: 'Fetched directly · updated {ago}',
      empty: '⚠️ Cannot reach government sources yet — retrying automatically',
      feedDown: 'This feed is temporarily down',
      warnTitle: 'Heavy rain / flash-flood warnings',
      warnNone: 'No warnings right now',
      badgeFlash: 'Flash flood', badgeHeavyRain: 'Heavy rain',
      province: '',
      amphoe: '',
      warnVeryHeavy: 'Very heavy rain',
      warnTotal: 'Total',
      bank: 'of bank',
      riverTitle: 'River situation',
      riverTotal: 'Total stations', riverOverflow: 'Overflowing', riverHigh: 'High',
      badgeCritical: 'Critical', riverNone: 'No critical stations',
      rainTitle: 'Top 24h rainfall', rainNone: 'No heavy-rain data', mm: 'mm',
      resTitle: 'Reservoirs / dams',
      resTotal: 'Total', resOverCap: 'Over capacity', resHigh: 'High',
      annTitle: 'Announcements / forecast (TMD)',
      badgeAnn: 'Notice', annRead: 'Read the full announcement',
    },
  },
};

function getPath(obj, key) {
  let node = obj;
  for (const part of key.split('.')) {
    if (node == null) return undefined;
    node = node[part];
  }
  return node;
}

/** translate('en', 'sensor.temp.label') · fills {vars}. Falls back to th, then the key. */
export function translate(lang, key, vars) {
  const table = DICT[lang] ?? DICT.th;
  let s = getPath(table, key);
  if (s == null) s = getPath(DICT.th, key);
  if (s == null) return key;
  if (vars) s = String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`));
  return s;
}
