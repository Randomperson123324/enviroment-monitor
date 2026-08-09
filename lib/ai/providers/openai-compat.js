/**
 * OpenAI-compatible chat provider — llama-swap, llama.cpp server, LM Studio,
 * Ollama, or any gateway speaking POST /v1/chat/completions.
 * Docs: https://lmstudio.ai/docs/app/api/endpoints/openai
 *
 * Non-streaming on purpose: /api/chat returns a single JSON reply, so there is
 * no SSE reader here (and no tool-call loop — this app exposes no tools).
 */

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

  const res = await fetch(url, {
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
  const res = await fetch(url, {
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
