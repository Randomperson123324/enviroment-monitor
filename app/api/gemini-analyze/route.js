import { getLatest, normalizeDeviceId } from '@/lib/dashboard';
import { analyzeReading, readingSummary, healthScore } from '@/lib/analysis';
import { aiAnalyze, aiEnabled } from '@/lib/ai';
import { relayTarget, relayFetch } from '@/lib/ai/relay';
import { jsonOk, aiOverridesFrom, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/gemini-analyze — re-fetch the latest reading from the DB and
 * analyze it with the configured AI providers, else the local rule engine.
 * Body may carry fallback sensor values from the browser cache.
 *
 * The path keeps its original name so existing clients and the relay hop stay
 * compatible; it is no longer Gemini-specific.
 */
export const POST = withErrors(async (request) => {
  const body = await request.json().catch(() => ({}));
  const overrides = aiOverridesFrom(request);

  const target = relayTarget(request, overrides);
  if (target) {
    try {
      const relayed = await relayFetch(request, target, '/api/gemini-analyze', body);
      return jsonOk({ ...relayed, via: 'relay' });
    } catch (err) {
      console.warn('[analyze] relay failed, serving locally:', err.message);
    }
  }

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

  if (aiEnabled(overrides)) {
    try {
      const ai = await aiAnalyze({ reading, summaryLine: readingSummary(reading), overrides });
      return jsonOk({
        source: ai.provider,
        provider: ai.provider,
        model: ai.model,
        via: 'direct',
        summary: ai.summary,
        recommendations: ai.recommendations.length ? ai.recommendations : local.recommendations,
        sensor,
      });
    } catch (err) {
      console.warn('[analyze] falling back to local:', err.message);
    }
  }

  return jsonOk({
    source: 'local',
    provider: 'local-rules',
    via: 'direct',
    summary: local.msg,
    recommendations: local.recommendations,
    sensor,
  });
});
