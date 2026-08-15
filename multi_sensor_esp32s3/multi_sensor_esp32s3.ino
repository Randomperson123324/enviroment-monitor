/*
  ESP32-S3 Multi-Sensor Air Quality Station  +  Supabase upload
  --------------------------------------------------------------
  Sensors (each on its OWN bus):
    - PMS7003   : PM1.0 / PM2.5 / PM10        -> UART2
    - SCD40     : CO2, Temperature, Humidity  -> I2C bus 0  (hardware Wire)
    - SGP30     : eCO2, TVOC                  -> I2C bus 1  (hardware Wire1)
    - BH1750    : Ambient light (lux)         -> I2C bus 2  (bit-banged software I2C)

  Why a software bus?
    The ESP32-S3 only has TWO hardware I2C peripherals (Wire, Wire1). To give every
    sensor a fully separate bus, BH1750 is driven by a small bit-banged I2C
    implementation below. BH1750 is trivial (one command byte out, two bytes in),
    so no library is needed for it.

  Wiring (adjust to your board):
    I2C bus 0 (SCD40) : SDA = GPIO8,  SCL = GPIO9
    I2C bus 1 (SGP30) : SDA = GPIO4,  SCL = GPIO5
    I2C bus 2 (BH1750): SDA = GPIO6,  SCL = GPIO7   <-- 4.7k pull-ups to 3V3 recommended
    UART (PMS7003)    : PMS TX -> GPIO17 (ESP RX), PMS RX -> GPIO18 (ESP TX)
                        PMS VCC = 5V, GND = GND

  Libraries required (Library Manager):
    - SparkFun SCD4x Arduino Library   (SparkFun Electronics)
    - Adafruit SGP30 Sensor            (Adafruit)
    - Adafruit BusIO / Adafruit Unified Sensor (dependencies)
    (BH1750 library is NO LONGER needed — replaced by the software-I2C driver.)

  Supabase:
    Fill in WIFI_SSID / WIFI_PASS / SUPABASE_URL / SUPABASE_ANON_KEY.
    Rows are POSTed to  <SUPABASE_URL>/rest/v1/environment

    Column mapping used below (matches the existing public.environment table):
      temperature <- SCD40 temperature (C)      real
      humidity    <- SCD40 relative humidity    real
      co2         <- SCD40 CO2 (ppm)            real      [added, see ALTER below]
      eco2        <- SGP30 eCO2 (ppm)           integer   [added, see ALTER below]
      tvoc        <- SGP30 TVOC (ppb)           integer   [added, see ALTER below]
      light       <- BH1750 illuminance (lux)   numeric
      pm1         <- PMS7003 PM1.0 (ug/m3)      real
      pm25        <- PMS7003 PM2.5 (ug/m3)      real
      pm10        <- PMS7003 PM10  (ug/m3)      real
      device_id   <- DEVICE_ID constant         text

    Columns this sketch does NOT write (they belong to other hardware):
      gas_ppm, gas_digital, sound, webcam_json

    Run this once in the Supabase SQL editor before first upload:

      alter table public.environment
        add column if not exists co2  real,
        add column if not exists eco2 integer,
        add column if not exists tvoc integer;

    And make sure the anon role is allowed to insert:

      alter table public.environment enable row level security;

      create policy "anon can insert" on public.environment
        for insert to anon with check (true);

    Note: if "id" is a plain bigint rather than an identity column, inserts will
    fail with a not-null violation. Fix with:

      alter table public.environment
        alter column id add generated always as identity;
*/

#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SparkFun_SCD4x_Arduino_Library.h>
#include <Adafruit_SGP30.h>

// ================= USER CONFIG =================
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// No trailing slash. e.g. "https://abcdefghijklm.supabase.co"
const char* SUPABASE_URL      = "https://YOUR-PROJECT-REF.supabase.co";
const char* SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
const char* SUPABASE_TABLE    = "environment";
const char* DEVICE_ID         = "esp32s3-station-01";

const unsigned long UPLOAD_INTERVAL = 30000;   // ms between Supabase uploads
// ===============================================

// ---------------- Pin configuration ----------------
// Bus 0 — SCD40 (hardware I2C 0)
#define I2C0_SDA 8
#define I2C0_SCL 9

// Bus 1 — SGP30 (hardware I2C 1)
#define I2C1_SDA 4
#define I2C1_SCL 5

// Bus 2 — BH1750 (software / bit-banged I2C)
#define SW_SDA 6
#define SW_SCL 7

#define PMS_RX_PIN 17   // ESP32 RX2  <- PMS7003 TX
#define PMS_TX_PIN 18   // ESP32 TX2  -> PMS7003 RX
#define PMS_BAUD   9600

HardwareSerial pmsSerial(2);   // UART2 for PMS7003

// Separate hardware I2C buses
TwoWire I2C_SCD = TwoWire(0);
TwoWire I2C_SGP = TwoWire(1);

// ---------------- Sensor objects ----------------
SCD4x scd4x;
Adafruit_SGP30 sgp30;

bool scd4xOK  = false;
bool sgp30OK  = false;
bool bh1750OK = false;

// ---------------- PMS7003 data ----------------
struct PMSData {
  uint16_t pm1_0_std, pm2_5_std, pm10_std;
  uint16_t pm1_0_atm, pm2_5_atm, pm10_atm;
  bool valid = false;
};
PMSData pmsData;

uint8_t pmsBuffer[32];

// ---------------- Latest values (for upload) ----------------
struct Reading {
  float    co2  = NAN, temp = NAN, hum = NAN;
  uint16_t tvoc = 0,   eco2 = 0;
  bool     sgpValid = false;
  float    lux = NAN;
  bool     luxValid = false;
};
Reading latest;

// ---------------- Timing ----------------
unsigned long lastReadTime = 0;
const unsigned long READ_INTERVAL = 3000;   // ms between print / SGP / BH1750 reads

// The SCD40 in periodic mode produces a NEW sample only every ~5 s, and the very
// first one arrives ~5 s after startPeriodicMeasurement(). Poll it faster than
// that so we never miss a sample, and CACHE the last good value between samples
// instead of throwing it away.
unsigned long lastSCDPoll = 0;
const unsigned long SCD_POLL_INTERVAL = 1000;    // ms — poll often, sensor gates freshness
unsigned long scdLastGoodMs = 0;                 // millis() of last successful read (0 = never)
const unsigned long SCD_STALE_MS = 60000;        // treat cached value as dead after this

unsigned long lastSGPCompensation = 0;
const unsigned long SGP_COMPENSATION_INTERVAL = 10000; // ms

unsigned long lastUpload = 0;

// True when we have an SCD40 value that is recent enough to publish
bool scdFresh() {
  return scdLastGoodMs != 0 && (millis() - scdLastGoodMs) < SCD_STALE_MS;
}

// =====================================================================
// Software (bit-banged) I2C — bus 2, dedicated to BH1750
// Open-drain emulation: LOW = drive output low, HIGH = release to input+pullup
// =====================================================================
#define SW_I2C_DELAY_US 5   // ~100 kHz

static inline void swSdaHigh() { pinMode(SW_SDA, INPUT_PULLUP); }
static inline void swSdaLow()  { pinMode(SW_SDA, OUTPUT); digitalWrite(SW_SDA, LOW); }
static inline void swSclHigh() { pinMode(SW_SCL, INPUT_PULLUP); }
static inline void swSclLow()  { pinMode(SW_SCL, OUTPUT); digitalWrite(SW_SCL, LOW); }
static inline bool swSdaRead() { pinMode(SW_SDA, INPUT_PULLUP); return digitalRead(SW_SDA); }
static inline void swDelay()   { delayMicroseconds(SW_I2C_DELAY_US); }

void swI2CInit() {
  swSdaHigh();
  swSclHigh();
  swDelay();
}

void swI2CStart() {
  swSdaHigh(); swSclHigh(); swDelay();
  swSdaLow();  swDelay();
  swSclLow();  swDelay();
}

void swI2CStop() {
  swSdaLow();  swDelay();
  swSclHigh(); swDelay();
  swSdaHigh(); swDelay();
}

// returns true if slave ACKed
bool swI2CWriteByte(uint8_t data) {
  for (int i = 0; i < 8; i++) {
    if (data & 0x80) swSdaHigh(); else swSdaLow();
    data <<= 1;
    swDelay();
    swSclHigh(); swDelay();
    swSclLow();  swDelay();
  }
  // read ACK
  swSdaHigh(); swDelay();
  swSclHigh(); swDelay();
  bool ack = (swSdaRead() == LOW);
  swSclLow(); swDelay();
  return ack;
}

uint8_t swI2CReadByte(bool ack) {
  uint8_t data = 0;
  swSdaHigh();
  for (int i = 0; i < 8; i++) {
    swDelay();
    swSclHigh(); swDelay();
    data = (data << 1) | (swSdaRead() ? 1 : 0);
    swSclLow();  swDelay();
  }
  // send ACK / NACK
  if (ack) swSdaLow(); else swSdaHigh();
  swDelay();
  swSclHigh(); swDelay();
  swSclLow();  swDelay();
  swSdaHigh();
  return data;
}

// =====================================================================
// BH1750 driver over the software bus
// =====================================================================
#define BH1750_ADDR              0x23
#define BH1750_POWER_ON          0x01
#define BH1750_RESET             0x07
#define BH1750_CONT_HIGH_RES     0x10   // 1 lx resolution, ~120 ms

bool bh1750SendCmd(uint8_t cmd) {
  swI2CStart();
  bool ok = swI2CWriteByte((BH1750_ADDR << 1) | 0);  // write
  if (ok) ok = swI2CWriteByte(cmd);
  swI2CStop();
  return ok;
}

bool bh1750Begin() {
  swI2CInit();
  if (!bh1750SendCmd(BH1750_POWER_ON)) return false;
  delay(10);
  bh1750SendCmd(BH1750_RESET);
  delay(10);
  if (!bh1750SendCmd(BH1750_CONT_HIGH_RES)) return false;
  delay(180);   // first conversion
  return true;
}

bool bh1750Read(float &lux) {
  swI2CStart();
  if (!swI2CWriteByte((BH1750_ADDR << 1) | 1)) {   // read
    swI2CStop();
    return false;
  }
  uint8_t hi = swI2CReadByte(true);
  uint8_t lo = swI2CReadByte(false);
  swI2CStop();

  uint16_t raw = ((uint16_t)hi << 8) | lo;
  lux = raw / 1.2f;
  return true;
}

// =====================================================================
void setup() {
  Serial.begin(115200);
  while (!Serial) { delay(10); }
  delay(500);

  Serial.println("\n=== ESP32-S3 Multi-Sensor Station (separate buses) ===");

  // ---- PMS7003 UART ----
  pmsSerial.begin(PMS_BAUD, SERIAL_8N1, PMS_RX_PIN, PMS_TX_PIN);
  Serial.println("PMS7003 UART initialized.");

  // ---- Bus 0: SCD40 ----
  I2C_SCD.begin(I2C0_SDA, I2C0_SCL, 100000);
  // begin() stops any running measurement, then starts periodic mode.
  // The first sample is available ~5 s later; samples repeat every ~5 s.
  if (scd4x.begin(I2C_SCD)) {
    scd4xOK = true;
    Serial.println("SCD40 initialized on I2C bus 0 (first sample in ~5 s).");
  } else {
    Serial.println("SCD40 not found on bus 0! Check wiring.");
  }

  // ---- Bus 1: SGP30 ----
  I2C_SGP.begin(I2C1_SDA, I2C1_SCL, 100000);
  if (sgp30.begin(&I2C_SGP)) {
    sgp30OK = true;
    Serial.print("SGP30 found on I2C bus 1. Serial#: ");
    Serial.print(sgp30.serialnumber[0], HEX);
    Serial.print(sgp30.serialnumber[1], HEX);
    Serial.println(sgp30.serialnumber[2], HEX);
  } else {
    Serial.println("SGP30 not found on bus 1!");
  }

  // ---- Bus 2 (software): BH1750 ----
  if (bh1750Begin()) {
    bh1750OK = true;
    Serial.println("BH1750 initialized on software I2C bus 2.");
  } else {
    Serial.println("BH1750 not found on bus 2!");
  }

  // ---- WiFi ----
  connectWiFi();

  Serial.println("Setup complete. Warming up sensors...\n");
  delay(2000);
}

// =====================================================================
void loop() {
  // Continuously drain PMS7003 serial buffer, looking for valid frames
  readPMS7003();

  // Poll the SCD40 on its own fast cadence. readMeasurement() returns false until
  // the sensor has a genuinely new sample (~every 5 s), so this is cheap and safe.
  // On success we keep the value; we do NOT clear it to NAN between samples.
  if (millis() - lastSCDPoll >= SCD_POLL_INTERVAL) {
    lastSCDPoll = millis();
    if (readSCD40(latest.co2, latest.temp, latest.hum)) {
      scdLastGoodMs = millis();
    }
  }

  if (millis() - lastReadTime >= READ_INTERVAL) {
    lastReadTime = millis();

    // Feed absolute humidity to SGP30 for compensated readings
    if (sgp30OK && scdFresh() && !isnan(latest.temp) && !isnan(latest.hum) &&
        millis() - lastSGPCompensation >= SGP_COMPENSATION_INTERVAL) {
      lastSGPCompensation = millis();
      uint32_t absHumidity = getAbsoluteHumidity(latest.temp, latest.hum);
      sgp30.setHumidity(absHumidity);
    }

    latest.sgpValid = readSGP30(latest.tvoc, latest.eco2);
    latest.luxValid = bh1750OK && bh1750Read(latest.lux);

    printReadings(latest);
  }

  if (millis() - lastUpload >= UPLOAD_INTERVAL) {
    lastUpload = millis();
    uploadToSupabase(latest);
  }
}

// =====================================================================
// WiFi
// =====================================================================
void connectWiFi() {
  Serial.printf("Connecting to WiFi \"%s\"", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWiFi connected. IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\nWiFi connection failed (will retry before uploads).");
  }
}

// =====================================================================
// Supabase — POST one row via PostgREST
// =====================================================================
void uploadToSupabase(const Reading &r) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Supabase] WiFi down, reconnecting...");
    WiFi.reconnect();
    return;
  }

  // ---- Build JSON body; omit fields we don't have valid data for ----
  String body = "{";
  body += "\"device_id\":\"" + String(DEVICE_ID) + "\"";

  // PMS7003 -> pm1 / pm25 / pm10   (real)
  if (pmsData.valid) {
    body += ",\"pm1\":"  + String(pmsData.pm1_0_atm);
    body += ",\"pm25\":" + String(pmsData.pm2_5_atm);
    body += ",\"pm10\":" + String(pmsData.pm10_atm);
  }
  // SCD40 -> temperature / humidity (real), co2 (real)
  if (scdFresh() && !isnan(r.co2)) {
    body += ",\"co2\":"         + String(r.co2, 0);
    body += ",\"temperature\":" + String(r.temp, 2);
    body += ",\"humidity\":"    + String(r.hum, 2);
  }
  // SGP30 -> eco2 / tvoc (integer)
  if (r.sgpValid) {
    body += ",\"eco2\":" + String(r.eco2);
    body += ",\"tvoc\":" + String(r.tvoc);
  }
  // BH1750 -> light (numeric)
  if (r.luxValid) {
    body += ",\"light\":" + String(r.lux, 1);
  }
  body += "}";

  String endpoint = String(SUPABASE_URL) + "/rest/v1/" + SUPABASE_TABLE;

  WiFiClientSecure client;
  client.setInsecure();          // skip cert validation (fine for a hobby project)
  client.setTimeout(10000);

  HTTPClient http;
  if (!http.begin(client, endpoint)) {
    Serial.println("[Supabase] http.begin() failed.");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Prefer", "return=minimal");
  http.setTimeout(10000);

  int code = http.POST(body);

  if (code > 0) {
    if (code == 200 || code == 201 || code == 204) {
      Serial.printf("[Supabase] OK (%d): %s\n", code, body.c_str());
    } else {
      Serial.printf("[Supabase] HTTP %d: %s\n", code, http.getString().c_str());
    }
  } else {
    Serial.printf("[Supabase] POST failed: %s\n", http.errorToString(code).c_str());
  }

  http.end();
}

// =====================================================================
// PMS7003 — parse raw 32-byte frame: 0x42 0x4D + 30 bytes payload
// =====================================================================
void readPMS7003() {
  static uint8_t idx = 0;

  while (pmsSerial.available() > 0) {
    uint8_t b = pmsSerial.read();

    if (idx == 0 && b != 0x42) continue;      // sync byte 1
    if (idx == 1 && b != 0x4D) { idx = 0; continue; } // sync byte 2

    pmsBuffer[idx++] = b;

    if (idx == 32) {
      idx = 0;

      // verify checksum
      uint16_t sum = 0;
      for (int i = 0; i < 30; i++) sum += pmsBuffer[i];
      uint16_t checksum = (pmsBuffer[30] << 8) | pmsBuffer[31];

      if (sum == checksum) {
        pmsData.pm1_0_std = (pmsBuffer[4]  << 8) | pmsBuffer[5];
        pmsData.pm2_5_std = (pmsBuffer[6]  << 8) | pmsBuffer[7];
        pmsData.pm10_std  = (pmsBuffer[8]  << 8) | pmsBuffer[9];
        pmsData.pm1_0_atm = (pmsBuffer[10] << 8) | pmsBuffer[11];
        pmsData.pm2_5_atm = (pmsBuffer[12] << 8) | pmsBuffer[13];
        pmsData.pm10_atm  = (pmsBuffer[14] << 8) | pmsBuffer[15];
        pmsData.valid = true;
      }
      return; // process one frame per call; loop() calls this frequently
    }
  }
}

// =====================================================================
// SCD40 (bus 0) — CO2 (ppm), Temperature (C), Humidity (%RH)
// =====================================================================
// Returns true only when a genuinely NEW sample was read from the sensor.
// Caller keeps the previous value when this returns false.
bool readSCD40(float &co2, float &temperature, float &humidity) {
  if (!scd4xOK) return false;

  // readMeasurement() returns true only when a fresh reading is available
  if (!scd4x.readMeasurement()) return false;

  float c = scd4x.getCO2();
  float t = scd4x.getTemperature();
  float h = scd4x.getHumidity();

  // A CO2 of 0 means the sensor answered but has no valid measurement yet
  // (happens during the first seconds after power-up).
  if (c <= 0) return false;

  co2 = c;
  temperature = t;
  humidity = h;
  return true;
}

// =====================================================================
// SGP30 (bus 1) — eCO2 (ppm), TVOC (ppb)
// =====================================================================
bool readSGP30(uint16_t &tvoc, uint16_t &eco2) {
  if (!sgp30OK) return false;
  if (!sgp30.IAQmeasure()) return false;
  tvoc = sgp30.TVOC;
  eco2 = sgp30.eCO2;
  return true;
}

// Convert temp/humidity to absolute humidity (mg/m^3) for SGP30 compensation
uint32_t getAbsoluteHumidity(float temperature, float humidity) {
  // Approximation formula (from Sensirion application note)
  const float absHumidity = 216.7f *
      ((humidity / 100.0f) * 6.112f * exp((17.62f * temperature) / (243.12f + temperature)) /
      (273.15f + temperature));
  const uint32_t absHumidityScaled = static_cast<uint32_t>(1000.0f * absHumidity); // mg/m^3 -> fixed point
  return absHumidityScaled;
}

// =====================================================================
// Print all readings to Serial Monitor
// =====================================================================
void printReadings(const Reading &r) {
  Serial.println("---------------------------------------------");

  // PMS7003 (UART)
  if (pmsData.valid) {
    Serial.printf("PM1.0: %u ug/m3 | PM2.5: %u ug/m3 | PM10: %u ug/m3\n",
                  pmsData.pm1_0_atm, pmsData.pm2_5_atm, pmsData.pm10_atm);
  } else {
    Serial.println("PMS7003: waiting for data...");
  }

  // SCD40 (bus 0) — value is cached between the sensor's ~5 s samples
  if (scdFresh() && !isnan(r.co2)) {
    Serial.printf("CO2: %.0f ppm | Temp: %.2f C | Humidity: %.2f %%RH  (age %lus)\n",
                  r.co2, r.temp, r.hum, (millis() - scdLastGoodMs) / 1000);
  } else if (scd4xOK) {
    Serial.println("SCD40: no valid sample yet (first one takes ~5 s after boot).");
  } else {
    Serial.println("SCD40: sensor not detected on bus 0.");
  }

  // SGP30 (bus 1)
  if (r.sgpValid) {
    Serial.printf("eCO2: %u ppm | TVOC: %u ppb\n", r.eco2, r.tvoc);
  } else if (sgp30OK) {
    Serial.println("SGP30: measurement not ready.");
  }

  // BH1750 (bus 2, software I2C)
  if (r.luxValid) {
    Serial.printf("Light: %.1f lux\n", r.lux);
  } else if (bh1750OK) {
    Serial.println("BH1750: read failed.");
  }

  Serial.println("---------------------------------------------\n");
}
