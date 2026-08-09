import { getLatest, normalizeDeviceId } from '@/lib/dashboard';
import { readingSummary } from '@/lib/analysis';
import { aiChat, aiEnabled } from '@/lib/ai';
import { relayTarget, relayFetch } from '@/lib/ai/relay';
import { MSG, fill } from '@/config/messages.th';
import { jsonOk, jsonError, aiOverridesFrom, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/chat — environment Q&A with the latest sensor reading attached.
 * Body: { message, history:[{role,content}], device_id }
 */
export const POST = withErrors(async (request) => {
  const body = await request.json().catch(() => null);
  const message = String(body?.message ?? '').trim();
  if (!message) return jsonError('message is required', 400);

  const overrides = aiOverridesFrom(request);

  // Relay first when configured: this host may have no route to the providers.
  const target = relayTarget(request, overrides);
  if (target) {
    try {
      return jsonOk({ ...(await relayFetch(request, target, '/api/chat', body)), via: 'relay' });
    } catch (err) {
      console.warn('[chat] relay failed, serving locally:', err.message);
    }
  }

  const latest = await getLatest(normalizeDeviceId(body?.device_id)).catch(() => null);
  const contextLine = readingSummary(latest);

  if (aiEnabled(overrides)) {
    try {
      const { reply, provider, model } = await aiChat({
        message,
        history: Array.isArray(body?.history) ? body.history : [],
        contextLine,
        overrides,
      });
      return jsonOk({ reply, source: provider, provider, model, via: 'direct' });
    } catch (err) {
      console.warn('[chat] all providers failed:', err.message);
    }
  }

  return jsonOk({
    reply: fill(MSG.chat.noKey, { summary: contextLine }),
    source: 'local',
    provider: 'local-rules',
    via: 'direct',
  });
});
