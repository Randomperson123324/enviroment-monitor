import config from '@/config';
import { listModels, providerReady, PROVIDERS } from '@/lib/ai/discovery';
import { jsonOk, jsonError, query, aiOverridesFrom, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ai/models?provider=local|gemini — the provider's own model list,
 * fetched server-side because the browser can reach neither the plain-HTTP
 * local endpoint (mixed content) nor Gemini without exposing the key.
 *
 * Feeds the Dev Settings model picker, so new models appear with no code change.
 */
export const GET = withErrors(async (request) => {
  const id = query(request).get('provider') || 'local';
  if (!PROVIDERS[id]) return jsonError(`unknown provider "${id}"`, 400);

  const overrides = aiOverridesFrom(request);
  if (!providerReady(id, overrides)) {
    return jsonOk({ provider: id, models: [], error: 'provider not configured' });
  }

  try {
    // Same budget the chain uses: this answers a button press, so it has to
    // come back with a verdict rather than sit on the provider's full timeout.
    const models = await listModels(id, overrides, { timeoutMs: config.ai.chainBudgetMs });
    return jsonOk({ provider: id, models });
  } catch (err) {
    // A dead endpoint shouldn't blank the settings dialog — the field stays free text.
    return jsonOk({ provider: id, models: [], error: err.message });
  }
});
