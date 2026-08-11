/**
 * OpenAI-compatible chat provider — llama-swap, llama.cpp server, LM Studio,
 * Ollama, or any gateway speaking POST /v1/chat/completions.
 * Docs: https://lmstudio.ai/docs/app/api/endpoints/openai
 *
 * Two entry points: `generate` for the one-shot JSON paths (summaries, analysis)
 * and `streamGenerate` for chat, which streams and calls tools.
 */
import { sseEvents } from '@/lib/ai/providers/sse';

/** Reasoning models split their answer; an empty `content` means the budget went to thinking. */
function readContent(data) {
  const choice = data?.choices?.[0];
  const text = String(choice?.message?.content ?? '').trim();
  if (text) return text;
  const reasoned = String(choice?.message?.reasoning_content ?? '').trim();
  if (reasoned) {
    throw new Error(
      `model spent its budget on reasoning and returned no content (finish_reason: ${choice?.finish_reason ?? '?'}) — raise maxTokens or disable thinking`
    );
  }
  throw new Error(`empty response (finish_reason: ${choice?.finish_reason ?? '?'})`);
}

function authHeaders(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

/**
 * fetch, but a transport failure says *why* and *from where*.
 *
 * This call is made by the server rendering the dashboard, not by the browser —
 * a bare "fetch failed" reads like a CORS problem when it is really "this host
 * has no route to that address" (loopback/LAN endpoint behind a hosted app,
 * closed port, DNS gone). Naming the URL and the socket error saves that guess.
 */
async function fetchEndpoint(url, init) {
  try {
    return await fetch(url, init);
  } catch (err) {
    const why =
      err.name === 'TimeoutError'
        ? 'no response before the timeout'
        : err.cause?.code ?? err.cause?.message ?? err.message;
    throw new Error(
      `cannot reach ${url} (${why}) — the endpoint must be reachable from the server running this app, not only from your browser`
    );
  }
}

/**
 * One chat completion.
 * messages: [{ role: 'user'|'assistant', content }] — systemInstruction is prepended.
 */
export async function generate({
  baseUrl,
  model,
  apiKey,
  systemInstruction,
  messages,
  jsonOutput = false,
  thinking = false,
  timeoutMs,
  maxTokens,
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const body = {
    model,
    messages: [
      ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
      ...messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content ?? ''),
      })),
    ],
    max_tokens: maxTokens,
    ...(jsonOutput ? { response_format: { type: 'json_object' } } : {}),
    // llama.cpp/Jinja templates read this to skip the thinking block entirely.
    ...(thinking ? {} : { chat_template_kwargs: { enable_thinking: false } }),
  };

  const res = await fetchEndpoint(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${detail.slice(0, 200)}`);
  }
  return readContent(await res.json());
}

/**
 * GET /v1/models → [{ id, label, status, ready }].
 * `status` is a llama-swap extension ("loaded" / "unloaded"); plain OpenAI
 * servers omit it, in which case every model is reported ready.
 */
export async function listModels({ baseUrl, apiKey, timeoutMs }) {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/models`;
  const res = await fetchEndpoint(url, {
    headers: authHeaders(apiKey),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`models ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data?.data) ? data.data : [])
    .filter((m) => m?.id)
    .map((m) => {
      const status = m.status?.value ?? '';
      return { id: m.id, label: m.id, status, ready: status ? status === 'loaded' : true };
    });
}

/**
 * Streaming chat completions with tool calling.
 * Docs: https://platform.openai.com/docs/guides/function-calling
 *
 * Yields the same normalized events as the Gemini provider, so the tool loop in
 * lib/ai/chat-stream.js is written once.
 *
 * Two details that differ from the non-streaming path:
 *  - Tool calls arrive in fragments. `index` identifies the call, the name comes
 *    in the first fragment and the JSON arguments accumulate across many. They
 *    can only be parsed once the stream says the turn is over.
 *  - `reasoning_content` is where llama.cpp and friends put thinking. It is a
 *    separate delta field, not a marked part as in Gemini.
 */
export async function* streamGenerate({
  baseUrl,
  model,
  apiKey,
  systemInstruction,
  messages,
  tools = [],
  thinking = false,
  timeoutMs,
  maxTokens,
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const body = {
    model,
    messages: [
      ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
      ...messages,
    ],
    max_tokens: maxTokens,
    stream: true,
    ...(tools.length
      ? {
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }
      : {}),
    ...(thinking ? {} : { chat_template_kwargs: { enable_thinking: false } }),
  };

  const res = await fetchEndpoint(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${detail.slice(0, 200)}`);
  }

  /** index → { id, name, args } accumulating across fragments. */
  const pending = new Map();
  let finish = '';

  for await (const payload of sseEvents(res)) {
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};

    if (delta.reasoning_content) yield { type: 'thinking', text: String(delta.reasoning_content) };
    if (delta.content) yield { type: 'delta', text: String(delta.content) };

    for (const frag of delta.tool_calls ?? []) {
      const key = frag.index ?? 0;
      if (!pending.has(key)) pending.set(key, { id: '', name: '', args: '' });
      const call = pending.get(key);
      if (frag.id) call.id = frag.id;
      if (frag.function?.name) call.name += frag.function.name;
      if (frag.function?.arguments) call.args += frag.function.arguments;
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }

  // Emitted at the end because the arguments are not valid JSON until then.
  for (const [key, call] of pending) {
    if (!call.name) continue;
    let args = {};
    try {
      args = call.args.trim() ? JSON.parse(call.args) : {};
    } catch {
      // A truncated argument object is worth surfacing as a tool error rather
      // than dropping the call: the model asked for something and deserves a
      // reply it can act on.
      args = { __parse_error: call.args.slice(0, 200) };
    }
    yield { type: 'call', id: call.id || `${call.name}-${key}`, name: call.name, args };
  }
  if (finish) yield { type: 'finish', reason: finish };
}
