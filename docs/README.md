# ENV//MONITOR — เอกสารเทคนิคฮาร์ดแวร์ (Raspberry Pi 5)

เอกสารชุดนี้อธิบายการย้ายชุดเซนเซอร์จาก **Arduino UNO Q** มาเป็น **Raspberry Pi 5**
พร้อมเพิ่มเซนเซอร์ใหม่ 5 ตัว (ไมโครโฟน · BH1750 · PMS7003 · SCD40 · SGP30) และกล้องสำหรับ Focus feature

> **ขอบเขตเอกสารชุดนี้:** เป็นเอกสารออกแบบฮาร์ดแวร์และ data contract เท่านั้น
> ยังไม่มีการแก้โค้ดใน `config/sensors.js`, `app/api/ingest/route.js` หรือสร้าง firmware
> ดู [05-data-schema.md § ขั้นตอนถัดไป](05-data-schema.md#4-ขั้นตอนถัดไป-code-changes) สำหรับรายการงานที่ต้องทำต่อ

---

## สารบัญ

### ภาพรวมระบบ

| เอกสาร | เนื้อหา |
|---|---|
| [01-architecture.md](01-architecture.md) | สถาปัตยกรรมใหม่, บล็อกไดอะแกรม, ตารางสรุปเซนเซอร์ทั้งหมด, รอบการอ่านค่า |
| [02-wiring.md](02-wiring.md) | ตาราง pinout เต็ม, I2C address map, การเปิดบัส I2C/UART, ผังต่อสาย |
| [03-power-budget.md](03-power-budget.md) | งบกระแสรายราง 3V3/5V, การเลือก PSU, ปัญหา inrush ของพัดลม PMS7003 |
| [04-calibration.md](04-calibration.md) | ขั้นตอน calibrate ทุกตัว: FRC/ASC, baseline SGP30, dB SPL offset, R0 ของ MQ2 |
| [05-data-schema.md](05-data-schema.md) | คอลัมน์ใหม่ใน Supabase, ingest payload contract, การตั้งชื่อ field |

### เอกสารรายอุปกรณ์ (`devices/`)

| อุปกรณ์ | วัดอะไร | อินเทอร์เฟซ | เอกสาร |
|---|---|---|---|
| PMS7003 | PM1.0 / PM2.5 / PM10 | UART 9600 | [devices/pms7003.md](devices/pms7003.md) |
| SCD40 | CO₂ / อุณหภูมิ / ความชื้น | I2C `0x62` | [devices/scd40.md](devices/scd40.md) |
| SGP30 | TVOC / eCO₂ | I2C `0x58` | [devices/sgp30.md](devices/sgp30.md) |
| BH1750 | ความสว่าง (lux) | I2C `0x23` | [devices/bh1750.md](devices/bh1750.md) |
| USB microphone | ระดับเสียง (dB) | USB Audio (UAC) | [devices/microphone-usb.md](devices/microphone-usb.md) |
| กล้อง (Focus) | ใบหน้า / EAR / การขยับ | CSI-2 หรือ USB | [devices/camera.md](devices/camera.md) |
| **ฐานงานวิจัย** | ค่าเซนเซอร์กับสมาธิ · ที่มาของทุกเกณฑ์ · รายการอ้างอิง 16 รายการ | — | [devices/research-basis.md](devices/research-basis.md) |
| **งบประมาณ** | ราคาชิ้นส่วนที่ต้องซื้อเพิ่ม · ลำดับการซื้อ · ค่าใช้จ่ายต่อเนื่อง | — | [devices/budget.md](devices/budget.md) |
| **สรุปทุกอุปกรณ์ (1 หน้า)** | ตารางเทียบ · pinout · งบไฟ · คำเตือน · calibrate | — | [devices/summary.md](devices/summary.md) |
| ~~MQ-2 + ADS1115~~ *(ไม่ใช้แล้ว)* | ก๊าซติดไฟรวม (legacy) | I2C `0x48` | [devices/mq2-ads1115.md](devices/mq2-ads1115.md) |

> **MQ-2 ถูกตัดออกจากชุดอุปกรณ์แล้ว** — ไฟล์ยังเก็บไว้เป็นบันทึกการตัดสินใจ แต่ไม่รวมอยู่ใน PDF
> และ Raspberry Pi 5 จึงไม่ต้องมี ADS1115 อีกต่อไป
> ผลที่ตามมา: ต้องแก้ `config/sensors.js` เอา sensor `gas` ออก และปรับ `AQI_LEVELS` ที่อ้างอิง `THRESHOLDS.gas`
> → ดู [05-data-schema.md](05-data-schema.md#4-ขั้นตอนถัดไป-code-changes)

### ไฟล์ PDF

[`ENV-MONITOR-devices.pdf`](ENV-MONITOR-devices.pdf) — เอกสารรายอุปกรณ์ 6 ตัว + งบประมาณ + หน้าสรุป 1 หน้า (46 หน้า A4)
สร้างใหม่ได้ด้วย `python3 docs/tools/build_devices_pdf.py` (ต้องมี `pandoc`, `weasyprint` และฟอนต์ไทย เช่น Loma/Garuda)

---

## สรุปสั้น: อะไรเปลี่ยนบ้าง

| หัวข้อ | เดิม (UNO Q) | ใหม่ (Pi 5) |
|---|---|---|
| อุณหภูมิ / ความชื้น | DHT22 | **SCD40** (แม่นกว่า, มากับ CO₂ ในตัวเดียว) |
| คุณภาพอากาศ | MQ-2 อย่างเดียว | **PMS7003 + SCD40 + SGP30** (+ MQ-2 ถ้าจะเก็บไว้) |
| ความสว่าง | LDR analog (ถ้ามี) | **BH1750** ให้ค่า lux จริง ไม่ต้อง map เอง |
| เสียง | ไมค์ analog | **USB microphone** คำนวณ dBA ได้ |
| ADC | มีในตัว MCU | **ไม่มีบน Pi 5** — ต้องเพิ่ม ADS1115 ถ้ายังใช้เซนเซอร์ analog |
| ตัวรันโค้ด | Arduino sketch (C++) | Python service บน Raspberry Pi OS |

### ประเด็นสำคัญที่ต้องอ่านก่อนต่อสาย

1. **Raspberry Pi 5 ไม่มี ADC** — เซนเซอร์ analog ทุกตัวต้องผ่าน ADC ภายนอก
   ซึ่งเป็นเหตุผลหลักที่ตัด MQ-2 ออก → [devices/mq2-ads1115.md](devices/mq2-ads1115.md)
2. **SCD40 ต้องจ่ายไฟ 3.3V เท่านั้น** ในระบบนี้ เพราะระดับลอจิก I2C = VDD
   ถ้าจ่าย 5V บัสจะกลายเป็น 5V และ **ทำ GPIO ของ Pi พัง** → [devices/scd40.md](devices/scd40.md#2--คำเตือนเรื่องแรงดัน)
3. **SGP30 ตัวเปล่าใช้ไฟ 1.8V เท่านั้น** — ต้องซื้อเป็นบอร์ด breakout ที่มี LDO + level shifter มาให้
   → [devices/sgp30.md](devices/sgp30.md#2--คำเตือนเรื่องแรงดัน)
4. **PMS7003 ต้องการ 5V สำหรับพัดลม แต่ลอจิกเป็น 3.3V** — ต่อ TX/RX เข้า Pi ตรงได้เลย ไม่ต้อง level shifter
   → [devices/pms7003.md](devices/pms7003.md)
5. **SGP30 ต้องอ่านทุก 1 วินาทีเป๊ะ ๆ** ไม่งั้น dynamic baseline เพี้ยน → [01-architecture.md § รอบการอ่านค่า](01-architecture.md#3-รอบการอ่านค่า-sampling-schedule)

---

## แหล่งอ้างอิงหลัก (datasheet ทางการ)

- [PMS7003 series data manual V2.5 — Plantower](https://download.kamami.pl/p564008-PMS7003%20series%20data%20manua_English_V2.5.pdf)
- [SCD4x Datasheet v1.7 (April 2025) — Sensirion](https://sensirion.com/media/documents/48C4B7FB/67FE0194/CD_DS_SCD4x_Datasheet_D1.pdf)
- [SGP30 Datasheet v0.9 — Sensirion](https://files.seeedstudio.com/wiki/Grove-VOC_and_eCO2_Gas_Sensor-SGP30/res/Sensirion_Gas_Sensors_SGP30_Datasheet_EN.pdf)
- [BH1750FVI Datasheet — ROHM](https://www.handsontec.com/dataspecs/sensor/BH1750%20Light%20Sensor.pdf)
- [Raspberry Pi Camera Module 3 product brief](https://datasheets.raspberrypi.com/camera/camera-module-3-product-brief.pdf)
- [Raspberry Pi 27W USB-C Power Supply product brief](https://datasheets.raspberrypi.com/power-supply/27w-usb-c-power-supply-product-brief.pdf)
