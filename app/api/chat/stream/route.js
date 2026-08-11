/**
 * POST /api/chat/stream — the assistant's streaming turn, as Server-Sent Events.
 * Body: { message, history:[{role,content}], device_id, lang, search, thinking }
 *
 * Separate from /api/chat rather than a `stream: true` flag on it, because the
 * two have different response types: one returns a JSON object, this one holds a
 * connection open and writes events. /api/chat stays as the fallback for a
 * browser or proxy that cannot do SSE.
 *
 * Event stream (each frame is `data: <json>`, terminated by `data: [DONE]`):
 *   { type:'start',      provider, model, tools:[name] }
 *   { type:'thinking',   text }        the model's reasoning, when asked for
 *   { type:'delta',      text }        answer text, append in order
 *   { type:'tool-start', name, args }  a tool is running
 *   { type:'tool',       name, ok, note }
 *   { type:'error',      message }
 *
 * Deltas are text fragments, not lines or sentences: the client concatenates.
 */
import config from '@/config';
import { chatStream } from '@/lib/ai/chat-stream';
import { normalizeDeviceId } from '@/lib/dashboard';
import { relayStreamFetch, relayTarget } from '@/lib/ai/relay';
import { searchConfigured } from '@/lib/ai/search';
import { aiOverridesFrom, jsonError } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Nginx buffers proxied responses by default, which holds the whole answer
  // back until the turn ends — the exact failure streaming exists to avoid.
  'X-Accel-Buffering': 'no',
};

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const message = String(body?.message ?? '').trim();
  if (!message) return jsonError('message is required', 400);
  if (!config.ai.stream.enabled) return jsonError('streaming is disabled', 503);

  const overrides = aiOverridesFrom(request);

  // Relay first, for the same reason /api/chat does: this host may have no route
  // to the providers. Falling back to serving locally is pointless if the relay
  // already started writing, so the hop is attempted before anything else.
  const target = relayTarget(request, overrides);
  if (target) {
    try {
      const upstream = await relayStreamFetch(request, target, '/api/chat/stream', body);
      return new Response(upstream.body, { headers: SSE_HEADERS });
    } catch (err) {
      console.warn('[chat/stream] relay failed, serving locally:', err.message);
    }
  }

  const encoder = new TextEncoder();
  const events = chatStream({
    message,
    history: Array.isArray(body?.history) ? body.history : [],
    deviceId: normalizeDeviceId(body?.device_id),
    lang: body?.lang === 'en' ? 'en' : 'th',
    // Two gates, and the server owns both: a client asking for search on a
    // deployment with no key would otherwise be promised a tool that cannot run.
    search: Boolean(body?.search) && searchConfigured(),
    thinking: Boolean(body?.thinking),
    overrides,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const ev of events) {
          // The user closed the panel or navigated away: stop generating rather
          // than finishing an answer nobody will read (and still paying for it).
          if (request.signal.aborted) break;
          send(ev);
        }
      } catch (err) {
        // Everything downstream of this already reports its own failures, so
        // reaching here means no provider could be started at all.
        console.warn('[chat/stream] failed:', err.message);
        send({ type: 'error', message: err.message });
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
