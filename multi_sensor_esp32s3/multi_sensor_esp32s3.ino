/*
  ESP32-S3 Multi-Sensor Air Quality Station
  ------------------------------------------
  Sensors:
    - PMS7003   : Particulate matter (PM1.0 / PM2.5 / PM10) — UART
    - SCD40     : CO2, Temperature, Humidity                — I2C
    - SGP30     : eCO2, TVOC                                — I2C
    - BH1750    : Ambient light (lux)                       — I2C

  Wiring (adjust to your board):
    I2C  -> SDA = GPIO8,  SCL = GPIO9   (SCD40, SGP30, BH1750 all share the bus)
    UART -> PMS7003 TX -> ESP32 RX2 (GPIO17)
            PMS7003 RX -> ESP32 TX2 (GPIO18)   (optional, PMS7003 mostly just streams data)
            PMS7003 VCC = 5V, GND = GND

  Libraries required (Install via Library Manager):
    - SparkFun SCD4x Arduino Library   (by SparkFun Electronics)
    - Adafruit SGP30 Sensor            (by Adafruit)
    - BH1750                           (by Christopher Laws)
    - Adafruit BusIO / Adafruit Unified Sensor (dependencies, auto-installed)

  Notes:
    - SGP30 needs ~15s of warmup and benefits from periodic humidity compensation,
      which this sketch feeds from the SCD40 readings for better accuracy.
    - PMS7003 is parsed manually from its raw 32-byte serial frame (no library needed).
*/

#include <Wire.h>
#include <SparkFun_SCD4x_Arduino_Library.h>
#include <Adafruit_SGP30.h>
#include <BH1750.h>

// ---------------- Pin configuration ----------------
#define I2C_SDA 8
#define I2C_SCL 9

#define PMS_RX_PIN 17   // ESP32 RX2  <- PMS7003 TX
#define PMS_TX_PIN 18   // ESP32 TX2  -> PMS7003 RX (not strictly required)
#define PMS_BAUD   9600

HardwareSerial pmsSerial(2);   // UART2 for PMS7003

// ---------------- Sensor objects ----------------
SCD4x scd4x;
Adafruit_SGP30 sgp30;
BH1750 lightMeter;

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

// ---------------- Timing ----------------
unsigned long lastReadTime = 0;
const unsigned long READ_INTERVAL = 3000;   // ms between full sensor reads

unsigned long lastSGPCompensation = 0;
const unsigned long SGP_COMPENSATION_INTERVAL = 10000; // ms

// =====================================================================
void setup() {
  Serial.begin(115200);
  while (!Serial) { delay(10); }
  delay(500);

  Serial.println("\n=== ESP32-S3 Multi-Sensor Station ===");

  // ---- I2C ----
  Wire.begin(I2C_SDA, I2C_SCL);

  // ---- PMS7003 UART ----
  pmsSerial.begin(PMS_BAUD, SERIAL_8N1, PMS_RX_PIN, PMS_TX_PIN);
  Serial.println("PMS7003 UART initialized.");

  // ---- SCD40 ----
  if (scd4x.begin(Wire)) {
    scd4xOK = true;
    Serial.println("SCD40 initialized.");
  } else {
    Serial.println("SCD40 not found! Check wiring.");
  }

  // ---- SGP30 ----
  if (sgp30.begin()) {
    sgp30OK = true;
    Serial.print("SGP30 found. Serial#: ");
    Serial.print(sgp30.serialnumber[0], HEX);
    Serial.print(sgp30.serialnumber[1], HEX);
    Serial.println(sgp30.serialnumber[2], HEX);
  } else {
    Serial.println("SGP30 not found!");
  }

  // ---- BH1750 ----
  if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
    bh1750OK = true;
    Serial.println("BH1750 initialized.");
  } else {
    Serial.println("BH1750 not found!");
  }

  Serial.println("Setup complete. Warming up sensors...\n");
  delay(2000);
}

// =====================================================================
void loop() {
  // Continuously drain PMS7003 serial buffer, looking for valid frames
  readPMS7003();

  if (millis() - lastReadTime >= READ_INTERVAL) {
    lastReadTime = millis();

    float co2 = NAN, temp = NAN, hum = NAN;
    readSCD40(co2, temp, hum);

    // Feed absolute humidity to SGP30 for compensated readings
    if (sgp30OK && !isnan(temp) && !isnan(hum) &&
        millis() - lastSGPCompensation >= SGP_COMPENSATION_INTERVAL) {
      lastSGPCompensation = millis();
      uint32_t absHumidity = getAbsoluteHumidity(temp, hum);
      sgp30.setHumidity(absHumidity);
    }

    uint16_t tvoc = 0, eco2 = 0;
    bool sgpValid = readSGP30(tvoc, eco2);

    float lux = NAN;
    bool luxValid = readBH1750(lux);

    printReadings(co2, temp, hum, tvoc, eco2, sgpValid, lux, luxValid);
  }
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
// SCD40 — CO2 (ppm), Temperature (C), Humidity (%RH)
// =====================================================================
void readSCD40(float &co2, float &temperature, float &humidity) {
  if (!scd4xOK) return;

  // readMeasurement() returns true only when a fresh reading is available
  if (scd4x.readMeasurement()) {
    co2 = scd4x.getCO2();
    temperature = scd4x.getTemperature();
    humidity = scd4x.getHumidity();
  }
}

// =====================================================================
// SGP30 — eCO2 (ppm), TVOC (ppb)
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
// BH1750 — Ambient light (lux)
// =====================================================================
bool readBH1750(float &lux) {
  if (!bh1750OK) return false;
  lux = lightMeter.readLightLevel();
  return lux >= 0;
}

// =====================================================================
// Print all readings to Serial Monitor
// =====================================================================
void printReadings(float co2, float temp, float hum,
                    uint16_t tvoc, uint16_t eco2, bool sgpValid,
                    float lux, bool luxValid) {
  Serial.println("---------------------------------------------");

  // PMS7003
  if (pmsData.valid) {
    Serial.printf("PM1.0: %u ug/m3 | PM2.5: %u ug/m3 | PM10: %u ug/m3\n",
                  pmsData.pm1_0_atm, pmsData.pm2_5_atm, pmsData.pm10_atm);
  } else {
    Serial.println("PMS7003: waiting for data...");
  }

  // SCD40
  if (!isnan(co2)) {
    Serial.printf("CO2: %.0f ppm | Temp: %.2f C | Humidity: %.2f %%RH\n", co2, temp, hum);
  } else {
    Serial.println("SCD40: no new data yet.");
  }

  // SGP30
  if (sgpValid) {
    Serial.printf("eCO2: %u ppm | TVOC: %u ppb\n", eco2, tvoc);
  } else if (sgp30OK) {
    Serial.println("SGP30: measurement not ready.");
  }

  // BH1750
  if (luxValid) {
    Serial.printf("Light: %.1f lux\n", lux);
  } else if (bh1750OK) {
    Serial.println("BH1750: read failed.");
  }

  Serial.println("---------------------------------------------\n");
}
