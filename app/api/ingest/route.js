import config from '@/config';
import { insertRow } from '@/lib/supabase';
import { analyzeReading } from '@/lib/analysis';
import { normalizeDeviceId } from '@/lib/dashboard';
import { SENSORS } from '@/config/sensors';
import { jsonOk, jsonError, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/** Accepted aliases per canonical field (Arduino firmware may send short names). */
const FIELD_ALIASES = {
  temperature: ['temperature', 'temp', 't'],
  humidity: ['humidity', 'hum', 'h'],
  gas_ppm: ['gas_ppm', 'gas', 'g'],
  sound: ['sound'],
  light: ['light'],
  gas_digital: ['gas_digital'],
  webcam_json: ['webcam_json', 'webcam'],
};

function pick(body, aliases) {
  for (const key of aliases) {
    if (body[key] != null) return body[key];
  }
  return null;
}

/**
 * POST /api/ingest — sensor upload endpoint for the Arduino UNO Q.
 * Body: {device_id, temperature|temp, humidity|hum, gas_ppm|gas, ...}
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
