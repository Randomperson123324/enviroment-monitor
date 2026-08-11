/**
 * Browser side of /api/chat/stream.
 *
 * `EventSource` is not an option here: the turn needs a POST body (message,
 * history, toggles) and the x-ai-* override headers, and EventSource can only
 * GET. So this is fetch + a hand-rolled reader over the same `data: …\n\n` frames
 * the server writes — the client half of lib/ai/providers/sse.js, kept separate
 * because that one imports server config.
 *
 * Yields parsed event objects; see the route for the event shapes.
 */

/** Frames can straddle chunk boundaries, so the tail is carried over. */
export async function* chatEvents({ url, headers, body, signal }) {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  // A failure before the stream opens is JSON, not SSE — report its message
  // rather than the bare status, since the route explains what was wrong.
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  if (!res.body) throw new Error('no response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');

      const data = raw
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');

      if (!data || data === '[DONE]') continue;
      try {
        yield JSON.parse(data);
      } catch {
        // Not worth killing a live answer over one unreadable frame.
      }
    }
  }
}
