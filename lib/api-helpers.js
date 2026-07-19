/** Shared helpers for App Router API routes. */
import { NextResponse } from 'next/server';

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

/** Optional browser-supplied Gemini key override. */
export function geminiKeyFrom(request) {
  return request.headers.get('x-gemini-key') || '';
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
