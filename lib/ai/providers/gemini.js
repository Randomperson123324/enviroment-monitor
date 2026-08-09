/**
 * Google AI Studio (Gemini) REST provider — generateContent, v1beta.
 * Docs: https://ai.google.dev/api/generate-content · https://ai.google.dev/api/models
 *
 * The key travels in the x-goog-api-key header rather than ?key=, so it stays
 * out of URLs, proxy logs and the relay hop.
 */

/** finishReason values that mean "this answer is not usable as-is". */
const BAD_FINISH = new Set(['MAX_TOKENS', 'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT']);

function keyHeaders(apiKey) {
  return { 'x-goog-api-key': apiKey };
}

/**
 * One generateContent call.
 * contents: [{ role: 'user'|'model', parts: [{ text }] }]
 */
export async function generate({
  baseUrl,
  model,
  apiKey,
  systemInstruction,
  contents,
  jsonOutput = false,
  responseSchema,
  timeoutMs,
  maxTokens,
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      ...(jsonOutput ? { responseMimeType: 'application/json' } : {}),
      ...(responseSchema ? { responseSchema } : {}),
    },
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...keyHeaders(apiKey) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  if (data.promptFeedback?.blockReason) {
    throw new Error(`prompt blocked (${data.promptFeedback.blockReason})`);
  }
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!text) {
    throw new Error(`empty response (finishReason: ${candidate?.finishReason ?? '?'})`);
  }
  // A truncated/filtered answer is worse than falling through to the next provider.
  if (BAD_FINISH.has(candidate?.finishReason)) {
    throw new Error(`unusable response (finishReason: ${candidate.finishReason})`);
  }
  return text;
}

/**
 * GET /models → [{ id, label, status, ready }], only models that can actually
 * run generateContent. Follows nextPageToken so nothing is silently cut off.
 */
export async function listModels({ baseUrl, apiKey, timeoutMs }) {
  const root = baseUrl.replace(/\/$/, '');
  const out = [];
  let pageToken = '';

  for (let page = 0; page < 10; page++) {
    const url = `${root}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, {
      headers: keyHeaders(apiKey),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`models ${res.status}`);
    const data = await res.json();

    for (const m of data.models ?? []) {
      if (!m?.name || !(m.supportedGenerationMethods ?? []).includes('generateContent')) continue;
      const id = m.name.replace(/^models\//, '');
      out.push({ id, label: m.displayName || id, status: '', ready: true });
    }

    pageToken = data.nextPageToken ?? '';
    if (!pageToken) break;
  }
  return out;
}
