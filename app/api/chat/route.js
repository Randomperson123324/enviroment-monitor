import { getLatest, normalizeDeviceId } from '@/lib/dashboard';
import { readingSummary } from '@/lib/analysis';
import { geminiChat, geminiEnabled } from '@/lib/gemini';
import { MSG, fill } from '@/config/messages.th';
import { jsonOk, jsonError, geminiKeyFrom, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/chat — environment Q&A with the latest sensor reading attached.
 * Body: { message, history:[{role,content}], device_id }
 */
export const POST = withErrors(async (request) => {
  const body = await request.json().catch(() => null);
  const message = String(body?.message ?? '').trim();
  if (!message) return jsonError('message is required', 400);

  const overrideKey = geminiKeyFrom(request);
  const latest = await getLatest(normalizeDeviceId(body?.device_id)).catch(() => null);
  const contextLine = readingSummary(latest);

  if (!geminiEnabled(overrideKey)) {
    return jsonOk({ reply: fill(MSG.chat.noKey, { summary: contextLine }), source: 'local' });
  }

  const reply = await geminiChat({
    message,
    history: Array.isArray(body?.history) ? body.history : [],
    contextLine,
    overrideKey,
  });
  return jsonOk({ reply, source: 'gemini' });
});
