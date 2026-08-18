import { getSummary, SCOPE_IDS } from '@/lib/ai/summaries';
import { jsonOk, jsonError, query, aiOverridesFrom, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ai/summary?scope=environment|focus|health&device_id=&force=1
 *
 * One cached AI summary per tab, regenerated at most every
 * config.ai.summary.ttlMs. Always 200: a provider failure comes back as
 * { ok: false, error } so a pinned scope can say the on-device model is down
 * rather than quietly answering from somewhere else.
 */
export const GET = withErrors(async (request) => {
  const q = query(request);
  const scope = q.get('scope') || 'environment';
  if (!SCOPE_IDS.includes(scope)) return jsonError(`unknown scope "${scope}"`, 400);

  const data = await getSummary(scope, {
    deviceId: q.get('device_id'),
    overrides: aiOverridesFrom(request),
    force: q.get('force') === '1',
  });
  return jsonOk({ scope, ...data });
});
