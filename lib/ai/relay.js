/**
 * Outbound relay: forward an AI request to another deployment of this app
 * instead of calling the model providers directly.
 *
 * Why it exists — the local endpoint is plain HTTP, so an HTTPS-hosted page is
 * blocked from reaching it by mixed content; and a demo box on a raw IP behind
 * venue Wi-Fi may have no route to Google at all. Pointing AI_RELAY_URL at the
 * hosted deployment puts one machine with known-good outbound access in charge.
 *
 * The relay target is this same app's own /api/chat + /api/gemini-analyze — no
 * extra public endpoint to secure. HOP_HEADER makes a relay loop impossible:
 * the relayed request carries it, and a request that carries it is never
 * relayed onward.
 */
import config from '@/config';

export const HOP_HEADER = 'x-ai-hop';

/** Headers worth carrying across the hop (keys/endpoints chosen in Dev Settings). */
const FORWARD_PREFIX = 'x-ai-';

export function relayTarget(request, overrides = {}) {
  const url = overrides.relayUrl || config.ai.relay.url;
  if (!url) return '';
  // Already relayed once — serve locally rather than bouncing on.
  if (request.headers.get(HOP_HEADER)) return '';
  return url.replace(/\/$/, '');
}

/**
 * POST the same body to `${target}${path}`. Returns the parsed JSON body.
 * Throws on transport failure or a non-2xx, so callers can fall back to
 * serving the request themselves.
 */
export async function relayFetch(request, target, path, body) {
  const headers = { 'Content-Type': 'application/json', [HOP_HEADER]: '1' };
  for (const [name, value] of request.headers) {
    // Don't forward x-ai-relay: the next hop must not relay again.
    if (name.startsWith(FORWARD_PREFIX) && name !== 'x-ai-relay') headers[name] = value;
  }

  const res = await fetch(`${target}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.ai.relay.timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`relay ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Same hop, but for a streamed endpoint: returns the upstream Response so the
 * caller can hand its body straight to the browser.
 *
 * Deliberately not buffered. Reading the stream here to re-emit it would undo
 * the point of streaming — the user would wait out the whole answer and then
 * receive it at once — so the bytes are passed through untouched, and the only
 * thing this function owns is the headers and the failure check.
 *
 * No timeout signal either: `AbortSignal.timeout` would cut a *working* stream
 * off at the deadline. The upstream route enforces its own budget, and the
 * client's abort signal covers a user who closes the panel.
 */
export async function relayStreamFetch(request, target, path, body) {
  const headers = { 'Content-Type': 'application/json', [HOP_HEADER]: '1' };
  for (const [name, value] of request.headers) {
    if (name.startsWith(FORWARD_PREFIX) && name !== 'x-ai-relay') headers[name] = value;
  }

  const res = await fetch(`${target}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: request.signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`relay ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res;
}
