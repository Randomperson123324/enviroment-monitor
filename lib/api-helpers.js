/** Shared helpers for App Router API routes. */
import { NextResponse } from 'next/server';
import config from '@/config';

export function jsonOk(data, init = {}) {
  return NextResponse.json(data, { status: 200, ...init });
}

export function jsonError(message, status = 500) {
  return NextResponse.json({ error: String(message) }, { status });
}

/** URLSearchParams of the request. */
export function query(request) {
  return new URL(request.url).searchParams;
}

/** Only http(s) URLs are accepted from the browser — everything else is dropped. */
function safeUrl(value) {
  if (!value) return '';
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? value.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Per-request AI overrides supplied by Dev Settings as x-ai-* headers, letting
 * the demo be re-pointed from the browser with no redeploy. Ignored entirely
 * when AI_ALLOW_CLIENT_OVERRIDES is off, since a caller-supplied base URL is
 * a URL this server will then fetch.
 */
export function aiOverridesFrom(request) {
  if (!config.ai.allowClientOverrides) return {};
  const h = (name) => (request.headers.get(name) || '').trim();
  const order = h('x-ai-order')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    order,
    relayUrl: safeUrl(h('x-ai-relay')),
    local: {
      baseUrl: safeUrl(h('x-ai-local-base')),
      model: h('x-ai-local-model'),
    },
    gemini: {
      // x-gemini-key kept as an alias so older browser sessions keep working.
      apiKey: h('x-ai-gemini-key') || h('x-gemini-key'),
      baseUrl: safeUrl(h('x-ai-gemini-base')),
      model: h('x-ai-gemini-model'),
    },
  };
}

/** Wrap a handler so thrown errors become clean JSON 500s. */
export function withErrors(handler) {
  return async (request, ctx) => {
    try {
      return await handler(request, ctx);
    } catch (err) {
      console.error('[api]', err);
      return jsonError(err.message || 'internal error');
    }
  };
}
