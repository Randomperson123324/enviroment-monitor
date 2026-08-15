import config from '@/config';
import { insertRow } from '@/lib/supabase';
import { analyzeReading } from '@/lib/analysis';
import { normalizeDeviceId } from '@/lib/dashboard';
import { SENSORS } from '@/config/sensors';
import { jsonOk, jsonError, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * Accepted aliases per canonical field (Arduino firmware may send short names).
 *
 * ⚠️ Never list 'pm10' as an alias of pm1: some libraries name PM1.0 "pm10",
 * which collides with PM10 exactly, and pick() would take the wrong value with
 * no error to see. Collectors must send the canonical names — the aliases are
 * only for compatibility.
 */
const FIELD_ALIASES = {
  temperature: ['temperature', 'temp', 't'],
  humidity: ['humidity', 'hum', 'h'],
  pm1: ['pm1', 'pm1_0'],
  pm25: ['pm25', 'pm2_5'],
  pm10: ['pm10'],
  co2: ['co2', 'co2_ppm'],
  eco2: ['eco2', 'co2eq'],
  sound: ['sound'],
  // ⚠️ `light` and `lux` are different columns on purpose, not a duplicate.
  // `light` is the retired LDR reading — a raw 0–1023 ADC count with no unit.
  // `lux` is the BH1750's real measurement in lx. Writing one into the other
  // would make every historical point jump scale for no visible reason (docs/05).
  light: ['light'],
  lux: ['lux', 'illuminance'],
  webcam_json: ['webcam_json', 'webcam'],
};

function pick(body, aliases) {
  for (const key of aliases) {
    if (body[key] != null) return body[key];
  }
  return null;
}

/**
 * POST /api/ingest — sensor upload endpoint for the room devices.
 * Body: {device_id, temperature|temp, humidity|hum, pm1, pm25, pm10, ...}
 * A sensor that cannot be read must be omitted or sent as null, never 0.
 */
export const POST = withErrors(async (request) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return jsonError('invalid JSON body', 400);

  const row = { device_id: normalizeDeviceId(body.device_id) };
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const v = pick(body, aliases);
    if (v != null) row[field] = v;
  }

  const warnings = [];
  for (const s of SENSORS) {
    const v = Number(row[s.field]);
    const [lo, hi] = s.range;
    if (!Number.isFinite(v)) warnings.push(`missing ${s.field}`);
    else if (v < lo || v > hi) warnings.push(`${s.field} out of range [${lo}, ${hi}]`);
  }

  const stored = await insertRow(config.supabase.envTable, row);
  const analysis = analyzeReading(stored);
  return jsonOk({
    ok: true,
    stored,
    health_score: analysis.score,
    ai_analysis: analysis,
    ...(warnings.length ? { _data_warnings: warnings } : {}),
  });
});
