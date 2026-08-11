/**
 * POST /api/ai/context — the snapshot prompt for the browser (WebGPU) engine.
 * Body: { device_id, lang }  →  { systemPrompt }
 *
 * The model runs in the user's browser, so it cannot reach Supabase or the
 * government feeds itself, and it is too small to be trusted with tools. This
 * route runs the same tool handlers server-side and returns one prompt.
 *
 * Not relayed: unlike the chat routes, nothing here talks to an AI provider, so
 * a host that cannot reach Google can still answer this by itself.
 */
import { buildBrowserPrompt } from '@/lib/ai/context';
import { normalizeDeviceId } from '@/lib/dashboard';
import { jsonError, jsonOk, withErrors } from '@/lib/api-helpers';
import config from '@/config';

export const dynamic = 'force-dynamic';

export const POST = withErrors(async (request) => {
  if (!config.ai.browser.enabled) return jsonError('browser AI is disabled', 503);

  const body = await request.json().catch(() => null);
  const systemPrompt = await buildBrowserPrompt({
    deviceId: normalizeDeviceId(body?.device_id),
    lang: body?.lang === 'en' ? 'en' : 'th',
  });

  return jsonOk({ systemPrompt }, { headers: { 'Cache-Control': 'no-store' } });
});
