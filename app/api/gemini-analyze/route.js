import { getLatest, normalizeDeviceId } from '@/lib/dashboard';
import { analyzeReading, readingSummary, healthScore } from '@/lib/analysis';
import { geminiAnalyze, geminiEnabled } from '@/lib/gemini';
import { jsonOk, geminiKeyFrom, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/gemini-analyze — re-fetch the latest reading from the DB and
 * analyze it with Gemini when a key is available, else the local rule engine.
 * Body may carry fallback sensor values from the browser cache.
 */
export const POST = withErrors(async (request) => {
  const body = await request.json().catch(() => ({}));
  const overrideKey = geminiKeyFrom(request);

  const fresh = await getLatest(normalizeDeviceId(body.device_id)).catch(() => null);
  const reading = fresh ?? {
    temperature: body.temperature,
    humidity: body.humidity,
    gas_ppm: body.gas_ppm,
  };

  const local = analyzeReading(reading);
  const sensor = {
    temperature: reading.temperature ?? null,
    humidity: reading.humidity ?? null,
    gas_ppm: reading.gas_ppm ?? null,
    health_score: healthScore(reading),
  };

  if (geminiEnabled(overrideKey)) {
    try {
      const ai = await geminiAnalyze(reading, readingSummary(reading), overrideKey);
      return jsonOk({
        source: 'gemini',
        summary: ai.summary,
        recommendations: ai.recommendations.length ? ai.recommendations : local.recommendations,
        sensor,
      });
    } catch (err) {
      console.warn('[gemini-analyze] falling back to local:', err.message);
    }
  }

  return jsonOk({
    source: 'local',
    summary: local.msg,
    recommendations: local.recommendations,
    sensor,
  });
});
