# 05 — โครงสร้างข้อมูลและ ingest contract

[← กลับสารบัญ](README.md)

---

## 1. คอลัมน์ปัจจุบันในตาราง `environment`

จาก `FIELD_ALIASES` ใน `app/api/ingest/route.js`:

| คอลัมน์ | ชนิด | มาจาก | สถานะ |
|---|---|---|---|
| `device_id` | text | — | ใช้ต่อ |
| `temperature` | float | DHT22 → **SCD40** | ใช้ต่อ (เปลี่ยนแหล่งที่มา) |
| `humidity` | float | DHT22 → **SCD40** | ใช้ต่อ (เปลี่ยนแหล่งที่มา) |
| `gas_ppm` | float | MQ-2 | ใช้ต่อ หรือเลิกใช้ ([→](devices/mq2-ads1115.md#1--ตัดสินใจก่อน-ยังต้องใช้-mq-2-อยู่ไหม)) |
| `sound` | float | ไมค์ analog (ค่าดิบ) | 🟡 **deprecated** — แทนที่ด้วย `sound_db` |
| `light` | float | LDR analog (ค่าดิบ) | 🟡 **deprecated** — แทนที่ด้วย `lux` |
| `gas_digital` | int | MQ-2 DOUT | 🟡 deprecated — ไม่มีความหมายเชิงปริมาณ |
| `webcam_json` | jsonb | กล้อง | ใช้ต่อ |
| `created_at` | timestamptz | ฐานข้อมูล | ใช้ต่อ |

### ทำไมต้องเพิ่มคอลัมน์ใหม่แทนที่จะใช้ `sound` / `light` เดิม

| เหตุผล | รายละเอียด |
|---|---|
| **หน่วยต่างกัน** | `light` เดิมเป็นค่าดิบจาก ADC (0–1023) ส่วน `lux` มีหน่วยจริง — คนละสเกล |
| **ข้อมูลเก่าจะเสีย** | ถ้าเขียนค่า lux ทับคอลัมน์ `light` กราฟย้อนหลังจะกระโดดอย่างไม่มีเหตุผล |
| **แยกอุปกรณ์ได้** | ถ้ายังมี UNO Q ทำงานอยู่ที่ไหนสักแห่ง ข้อมูลจะไม่ปนกัน |

> ✅ **แนวทาง:** เพิ่มคอลัมน์ใหม่ · ปล่อยคอลัมน์เก่าเป็น `NULL` สำหรับข้อมูลจาก Pi 5 · เก็บข้อมูลเก่าไว้ตามเดิม

---

## 2. คอลัมน์ใหม่ที่ต้องเพิ่ม

| คอลัมน์ | ชนิด | หน่วย | มาจาก | ช่วงค่าที่เป็นไปได้ |
|---|---|---|---|---|
| `pm1` | float | µg/m³ | PMS7003 Data4 | 0–1000 |
| `pm25` | float | µg/m³ | PMS7003 Data5 | 0–1000 |
| `pm10` | float | µg/m³ | PMS7003 Data6 | 0–1000 |
| `co2` | float | ppm | SCD40 | 0–40000 |
| `tvoc` | float | ppb | SGP30 | 0–60000 |
| `eco2` | float | ppm | SGP30 | 400–60000 |
| `lux` | float | lx | BH1750 | 0–65535 |
| `sound_db` | float | dB(A) | ไมค์ USB | 20–120 |

### หลักการตั้งชื่อ

| กฎ | ตัวอย่าง |
|---|---|
| snake_case ทั้งหมด | `sound_db` ไม่ใช่ `soundDb` |
| ไม่มีจุดหรือขีดในชื่อ | `pm25` ไม่ใช่ `pm2.5` หรือ `pm2_5` |
| ใส่หน่วยต่อท้ายเมื่อคลุมเครือ | `sound_db` (เพราะ `sound` ถูกใช้ไปแล้ว) · แต่ `co2` ไม่ต้องใส่ `_ppm` เพราะไม่มีหน่วยอื่น |
| ตรงกับชื่อบน API และ DB | ชื่อเดียวกันตลอดตั้งแต่ firmware → API → DB → UI |

### SQL migration

```sql
-- Migration: เพิ่มคอลัมน์เซนเซอร์ใหม่สำหรับ Raspberry Pi 5
-- รันบน Supabase SQL Editor
-- ปลอดภัย: เพิ่มคอลัมน์แบบ nullable ทั้งหมด ข้อมูลเดิมไม่กระทบ

ALTER TABLE environment
  ADD COLUMN IF NOT EXISTS pm1       real,
  ADD COLUMN IF NOT EXISTS pm25      real,
  ADD COLUMN IF NOT EXISTS pm10      real,
  ADD COLUMN IF NOT EXISTS co2       real,
  ADD COLUMN IF NOT EXISTS tvoc      real,
  ADD COLUMN IF NOT EXISTS eco2      real,
  ADD COLUMN IF NOT EXISTS lux       real,
  ADD COLUMN IF NOT EXISTS sound_db  real;

COMMENT ON COLUMN environment.pm1      IS 'PM1.0 µg/m³ — PMS7003 Data4 (สภาพบรรยากาศ)';
COMMENT ON COLUMN environment.pm25     IS 'PM2.5 µg/m³ — PMS7003 Data5 (สภาพบรรยากาศ)';
COMMENT ON COLUMN environment.pm10     IS 'PM10 µg/m³ — PMS7003 Data6 (สภาพบรรยากาศ)';
COMMENT ON COLUMN environment.co2      IS 'CO2 ppm — SCD40 (ค่าวัดจริงแบบ NDIR)';
COMMENT ON COLUMN environment.tvoc     IS 'TVOC ppb — SGP30';
COMMENT ON COLUMN environment.eco2     IS 'eCO2 ppm — SGP30 (ค่าประมาณจาก VOC ไม่ใช่ CO2 จริง)';
COMMENT ON COLUMN environment.lux      IS 'ความสว่าง lx — BH1750';
COMMENT ON COLUMN environment.sound_db IS 'ระดับเสียง dB — ไมค์ USB (offset จาก calibrate)';

-- ดัชนีสำหรับ query ตามช่วงเวลา (ถ้ายังไม่มี)
CREATE INDEX IF NOT EXISTS idx_environment_created_at
  ON environment (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_environment_device_created
  ON environment (device_id, created_at DESC);
```

> ⚠️ **ทุกคอลัมน์ต้องเป็น nullable** เพราะเซนเซอร์ตัวใดตัวหนึ่งอาจอ่านไม่ได้ชั่วคราว
> `NULL` = "อ่านไม่ได้" ซึ่งต่างจาก `0` = "อ่านได้และค่าเป็นศูนย์" อย่างสิ้นเชิง

---

## 3. Ingest payload contract

### Endpoint

```
POST /api/ingest
Content-Type: application/json
```

### ตัวอย่าง payload เต็ม

```json
{
  "device_id": "pi5-room1",
  "temperature": 27.4,
  "humidity": 58.2,
  "co2": 742,
  "pm1": 8,
  "pm25": 12,
  "pm10": 15,
  "tvoc": 120,
  "eco2": 615,
  "lux": 412,
  "sound_db": 46.8,
  "gas_ppm": 92,
  "webcam_json": {
    "present": true,
    "ear_avg": 0.28,
    "blink_rate": 14,
    "motion_per_min": 6
  }
}
```

### ตัวอย่างเมื่อเซนเซอร์บางตัวอ่านไม่ได้

```json
{
  "device_id": "pi5-room1",
  "temperature": 27.4,
  "humidity": 58.2,
  "co2": 742,
  "pm1": null,
  "pm25": null,
  "pm10": null,
  "tvoc": 120,
  "eco2": 615,
  "lux": 412,
  "sound_db": 46.8
}
```

### กฎการส่งข้อมูล

| กฎ | เหตุผล |
|---|---|
| อ่านไม่ได้ → ส่ง `null` **ห้ามส่ง `0`** | `healthScore()` ใน `lib/analysis.js` ใช้ `Number.isFinite()` กรอง ถ้าส่ง 0 จะถูกนับเป็นค่าจริง |
| ยัง warm-up อยู่ → ส่ง `null` | ค่าช่วง warm-up ไม่ถูกต้อง (ดู [01-architecture.md § 5](01-architecture.md#5-ลำดับการบูตและ-warm-up)) |
| ส่งทุก 5 วินาที | ตรงกับ `CLIENT_POLL_MS_DEFAULT` |
| `device_id` คงที่ตลอด | ใช้แยกอุปกรณ์บนแดชบอร์ด |
| ค่าตัวเลขเป็น number ไม่ใช่ string | `"27.4"` จะผ่าน `Number()` ได้ก็จริง แต่ทำให้ตรวจสอบยาก |
| ปัดทศนิยมให้เหมาะสม | อุณหภูมิ/ความชื้น 1 ตำแหน่ง · PM/CO₂/TVOC/lux เป็นจำนวนเต็ม |

### การตอบกลับ

```json
{
  "ok": true,
  "stored": { "...": "แถวที่บันทึกจริง" },
  "health_score": 87,
  "ai_analysis": { "...": "ผลจาก analyzeReading()" },
  "_data_warnings": ["missing gas_ppm"]
}
```

`_data_warnings` จะปรากฏเมื่อค่าหายหรืออยู่นอกช่วง — ควร log ไว้ฝั่ง Pi เพื่อตรวจสอบ

### การจัดการข้อผิดพลาดฝั่ง Pi

| สถานการณ์ | ทำอย่างไร |
|---|---|
| HTTP 5xx | retry แบบ exponential backoff (เช่น 1s → 2s → 4s → 8s สูงสุด 60s) |
| HTTP 4xx | **อย่า retry** — payload ผิด ต้อง log แล้วข้าม |
| Timeout / เน็ตหลุด | เก็บลง queue บนดิสก์ (จำกัดจำนวนแถว เช่น 5,000) แล้วส่งย้อนหลังเมื่อกลับมา |
| Queue เต็ม | ทิ้งแถวเก่าสุด (FIFO) ไม่ใช่หยุดเก็บ |

> ค่า retry delay, จำนวน queue สูงสุด, timeout — **ทุกตัวต้องอยู่ในไฟล์ config**

---

## 4. ขั้นตอนถัดไป (code changes)

เอกสารชุดนี้**ยังไม่ได้แก้โค้ดใด ๆ** นี่คือรายการงานที่ต้องทำต่อ เรียงตามลำดับที่แนะนำ

### ขั้นที่ 1 — ฐานข้อมูล

- [ ] รัน SQL migration ด้านบนบน Supabase

### ขั้นที่ 2 — API รับข้อมูล (`app/api/ingest/route.js`)

- [ ] เพิ่ม field ใหม่เข้า `FIELD_ALIASES`:

```js
const FIELD_ALIASES = {
  // ...ของเดิม
  pm1:      ['pm1', 'pm1_0'],
  pm25:     ['pm25', 'pm2_5'],
  pm10:     ['pm10'],
  co2:      ['co2', 'co2_ppm'],
  tvoc:     ['tvoc'],
  eco2:     ['eco2', 'co2eq'],
  lux:      ['lux', 'illuminance'],
  sound_db: ['sound_db', 'db', 'dba'],
};
```

> ⚠️ **ห้ามใส่ `'pm10'` เป็น alias ของ `pm1` เด็ดขาด** — บางไลบรารีเรียก PM1.0 ว่า `pm10`
> (ย่อจาก "PM 1.0") ซึ่งชนกับ PM10 พอดี ถ้าใส่ทั้งสองความหมายเข้าไป
> `pick()` จะหยิบค่าผิดโดยไม่มี error ให้เห็น
>
> **ทางที่ปลอดภัย:** กำหนดให้ firmware บน Pi ส่งเฉพาะชื่อ canonical (`pm1`, `pm25`, `pm10`)
> alias มีไว้เผื่อความเข้ากันได้เท่านั้น ไม่ใช่สิ่งที่ควรพึ่งพา

### ขั้นที่ 3 — นิยามเซนเซอร์ (`config/sensors.js`)

- [ ] เพิ่ม `THRESHOLDS` สำหรับค่าใหม่ทุกตัว
- [ ] เพิ่มรายการใน `SENSORS` (แต่ละตัวต้องมี `level()`, `text()`, `bar`, `badge`)
- [ ] เพิ่ม `SCORE_PENALTY` สำหรับค่าที่จะเอาไปคิดคะแนน
- [ ] ตัดสินใจว่าจะเก็บ sensor `gas` ไว้ไหม ([→](devices/mq2-ads1115.md#1--ตัดสินใจก่อน-ยังต้องใช้-mq-2-อยู่ไหม))

**ค่าเกณฑ์ที่แนะนำ** (รวบรวมจากเอกสารรายอุปกรณ์):

```js
export const THRESHOLDS = {
  // ...ของเดิม
  pm25: { min: 0, max: 1000, good: 15, warn: 25, danger: 37.5, critical: 75 },
  pm10: { min: 0, max: 1000, good: 45, warn: 120, danger: 180, critical: 300 },
  co2:  { min: 0, max: 40000, good: 800, warn: 1000, danger: 1500, critical: 2500 },
  tvoc: { min: 0, max: 60000, good: 220, warn: 660, danger: 2200, critical: 5000 },
  lux:  { min: 0, max: 65535, okLo: 300, okHi: 1000, warnLo: 150, warnHi: 2000 },
  db:   { min: 0, max: 130, good: 45, warn: 60, danger: 75, critical: 85 },
};
```

ที่มาของแต่ละค่า:

| ค่า | อ้างอิง |
|---|---|
| `pm25.danger = 37.5` | มาตรฐาน PM2.5 ของไทย ค่าเฉลี่ย 24 ชม. (บังคับใช้ 1 มิ.ย. 2566) |
| `pm25.good = 15` | WHO Air Quality Guideline 2021 (24 ชม.) |
| `co2.warn = 1000` | เกณฑ์คุณภาพอากาศในอาคารที่ใช้กันแพร่หลาย |
| `tvoc` | แนวทางของหน่วยงานสิ่งแวดล้อมเยอรมนี (UBA) |
| `lux.okLo = 300` | มาตรฐานความสว่างพื้นที่ทำงาน |
| `db.warn = 60` | ระดับที่เริ่มรบกวนสมาธิ |

### ขั้นที่ 4 — Analysis engine (`lib/analysis.js`)

- [ ] `healthScore()` ปัจจุบันคิดจาก `temperature`, `humidity`, `gas_ppm` เท่านั้น
      → ตัดสินใจว่าจะเพิ่ม PM2.5 และ CO₂ เข้าไปด้วยไหม
- [ ] `buildIssues()` มี `if (s.id === ...)` แบบ hardcode สำหรับ temp/hum/gas
      → **ตรงนี้จะเริ่มฝืนเมื่อเพิ่มเซนเซอร์อีก 6 ตัว** ควร refactor ให้ข้อความ warn/danger
      ย้ายไปอยู่ในนิยาม `SENSORS` แต่ละตัวแทนการ if แยกใน analysis
- [ ] เพิ่มข้อความใหม่ใน `config/messages.th.js`

> 🔴 **นี่คือ refactor checkpoint** — การเพิ่มเซนเซอร์ 6 ตัวเข้าโครงสร้างที่ออกแบบมาสำหรับ 3 ตัว
> จะทำให้ `buildIssues()` มี if-else ยาวขึ้นเรื่อย ๆ ควรจัดโครงสร้างใหม่**ก่อน**เพิ่ม ไม่ใช่หลัง

### ขั้นที่ 5 — สถิติและกราฟ

- [ ] `lib/stats.js` → เพิ่ม field ใหม่ใน `STAT_KEYS`
- [ ] `config/client.js` → เพิ่มสีของเส้นกราฟใหม่ใน `CHART_COLORS` (ทั้ง light และ dark)
      ⚠️ ต้องตรวจ contrast และการแยกแยะสำหรับคนตาบอดสี ตามที่คอมเมนต์ในไฟล์ระบุไว้
- [ ] `components/ChartsSection.jsx` → กราฟจะแน่นเกินไปถ้าใส่ 11 เส้นในกราฟเดียว
      → พิจารณาแยกเป็นหลายกราฟ หรือให้ผู้ใช้เลือกเส้นที่จะแสดง

### ขั้นที่ 6 — UI

- [ ] `components/SensorTiles.jsx` → จะมี 11 tile ต้องดูเรื่อง layout
- [ ] `components/Overview.jsx` · `StatsTable.jsx` → รองรับ field ใหม่

### ขั้นที่ 7 — Firmware บน Pi 5

- [ ] เขียน collector service ตามโครงสร้างใน [01-architecture.md § 4](01-architecture.md#4-โครงสร้างซอฟต์แวร์ที่แนะนำบน-pi-5)
- [ ] ตั้ง systemd unit ให้รันอัตโนมัติตอนบูต พร้อม `Restart=always`

### ขั้นที่ 8 — เอกสารและ config

- [ ] อัปเดต `.env.example` ถ้ามีค่าใหม่ฝั่งเซิร์ฟเวอร์
- [ ] อัปเดต `package.json → description` ที่ยังเขียนว่า "Arduino UNO Q"

---

## 5. ⚠️ Technical debt ที่ต้องรู้ล่วงหน้า

| หนี้ | ผลกระทบ | ควรจัดการเมื่อไหร่ |
|---|---|---|
| `buildIssues()` ใน `lib/analysis.js` ใช้ `if (s.id === ...)` แยกรายเซนเซอร์ | เพิ่มเซนเซอร์ = แก้ฟังก์ชันนี้ทุกครั้ง ผิดหลัก open/closed | **ก่อน**เพิ่มเซนเซอร์ใหม่ |
| `healthScore()` hardcode ว่าคิดจาก 3 ค่า | เพิ่มเซนเซอร์แล้วคะแนนไม่สะท้อนความจริง | พร้อมกับข้างบน |
| `CHART_VIEW_DEFAULTS.gasAxisDivisor` เป็นวิธีแก้เฉพาะหน้าสำหรับสเกลกราฟ | เมื่อมี 11 เส้นที่สเกลต่างกันมาก วิธีนี้จะไม่พอ | ตอนทำกราฟใหม่ |
| คอลัมน์ `sound` / `light` / `gas_digital` ที่เลิกใช้ | สับสนว่าควรใช้ตัวไหน | ทิ้งไว้ก่อนเพื่อเก็บข้อมูลเก่า · ลบเมื่อไม่ต้องใช้ข้อมูลย้อนหลังแล้ว |
| `package.json` ระบุว่าเป็น Arduino UNO Q | เอกสารไม่ตรงความจริง | ตอนขั้นที่ 8 |

> ตามหลัก `cid-coding-style` Step 0 ข้อ 4: ทุก 3–4 feature ที่เพิ่ม ต้องหยุดตรวจว่าโครงสร้างเดิมยังรองรับไหม
> **การเพิ่มเซนเซอร์ 6 ตัวรวดเดียวคือจุดที่ต้องหยุดตรวจ** — แนะนำให้ refactor `analysis.js`
> และ `sensors.js` ก่อน แล้วค่อยเพิ่มเซนเซอร์ทีละตัว ไม่ใช่เพิ่มทั้งหมดแล้วค่อยมาแก้ทีหลัง

---

[← ก่อนหน้า: การ calibrate](04-calibration.md) · [กลับสารบัญ](README.md)
