/**
 * Google AI Studio (Gemini) REST provider — generateContent, v1beta.
 * Docs: https://ai.google.dev/api/generate-content · https://ai.google.dev/api/models
 *
 * The key travels in the x-goog-api-key header rather than ?key=, so it stays
 * out of URLs, proxy logs and the relay hop.
 */

import { sseEvents } from '@/lib/ai/providers/sse';

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

/**
 * The thinking dial, per model family.
 *
 * Asking for thoughts takes two settings, not one: `includeThoughts` asks for
 * the summary, and the *level* decides whether there is any thinking to
 * summarise. Gemini 3's Flash-Lite models — including the default
 * gemini-3.5-flash-lite — sit at `minimal` unless told otherwise, so a request
 * carrying only `includeThoughts: true` came back well-formed, unrefused, and
 * with no thought parts in it. That is the whole of "the brain button does
 * nothing" on Flash-Lite.
 * Docs: https://ai.google.dev/gemini-api/docs/generate-content/thinking
 *
 * The dial's name changed with the family: 2.5 counts tokens (`thinkingBudget`,
 * -1 = let the model decide, and Flash-Lite ships at 0 = no thinking at all),
 * 3.x takes a word (`thinkingLevel`: minimal · low · medium · high). Sending
 * both at once is a 400, and sending the wrong one is the flat "Request contains
 * an invalid argument." that 781df22 chased — so the family is read off the
 * model id, and every other shape is kept behind it as a fallback for names this
 * parse has never seen. The list runs from "what should work" to "an answer
 * without thoughts", each step tried only when the one before it is refused.
 */
const THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'high']);

function thinkingLadder(model, level) {
  const wanted = THINKING_LEVELS.has(String(level).toLowerCase())
    ? String(level).toLowerCase()
    : 'medium';
  const byLevel = { includeThoughts: true, thinkingLevel: wanted };
  // Google's own examples are lowercase, but the field is a proto enum and
  // proto JSON spells those in caps — one retry costs nothing and settles it.
  const byLevelUpper = { includeThoughts: true, thinkingLevel: wanted.toUpperCase() };
  const byBudget = { includeThoughts: true, thinkingBudget: -1 };
  const plain = { includeThoughts: true };

  // 'gemini-3.5-flash-lite' → 3.5 · 'gemini-2.5-flash' → 2.5 · unversioned → 0
  const m = /gemini-(\d+)(?:\.(\d+))?/i.exec(model ?? '');
  const version = m ? Number(`${m[1]}.${m[2] ?? '0'}`) : 0;

  // `null` is the last rung: no thinkingConfig at all. Losing the thoughts beats
  // losing the answer.
  return version >= 2 && version < 3
    ? [byBudget, byLevel, plain, null]
    : [byLevel, byLevelUpper, byBudget, plain, null];
}

/**
 * Streaming generateContent with tool calling.
 * Docs: https://ai.google.dev/gemini-api/docs/function-calling
 *       https://ai.google.dev/gemini-api/docs/generate-content/thinking
 *
 * Yields normalized events so the caller never sees Gemini's shape:
 *   { type: 'thinking', text }   a thought part (only when includeThoughts)
 *   { type: 'delta',    text }   answer text
 *   { type: 'call', id, name, args }
 *   { type: 'finish', reason }
 *
 * `tools` arrive as JSON Schema and go out as functionDeclarations. Gemini
 * rejects an empty `properties`, so a no-argument tool is declared without a
 * parameters field at all rather than with an empty object.
 */
export async function* streamGenerate({
  baseUrl,
  model,
  apiKey,
  systemInstruction,
  contents,
  tools = [],
  thinking = false,
  thinkingLevel = 'medium',
  timeoutMs,
  maxTokens,
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  const declarations = tools.map((t) => {
    const props = t.parameters?.properties ?? {};
    return {
      name: t.name,
      description: t.description,
      ...(Object.keys(props).length ? { parameters: t.parameters } : {}),
    };
  });

  // Nothing at all when thoughts are not wanted: the old code sent
  // `thinkingConfig: { thinkingBudget: 0 }` to suppress them, and Gemini 3
  // refused every turn that carried it (781df22).
  const ladder = thinking ? thinkingLadder(model, thinkingLevel) : [null];

  const post = (thinkingConfig) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...keyHeaders(apiKey) },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: maxTokens,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
        ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
        ...(declarations.length ? { tools: [{ functionDeclarations: declarations }] } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

  let res;
  let detail = '';
  for (const [i, thinkingConfig] of ladder.entries()) {
    res = await post(thinkingConfig);
    if (res.ok) break;
    detail = await res.text().catch(() => '');

    /**
     * Step down the ladder only when the thinking settings are plausibly the
     * cause: either Google names them, or it names nothing at all (the flat
     * "Request contains an invalid argument.", which is what an unsupported
     * generationConfig field gets). A 400 that names something specific — a
     * missing thought_signature, a bad tool schema — is reported as-is.
     *
     * Retrying on *any* 400 was worse than not retrying: it turned the
     * missing-signature error into a silent thoughts-free answer, so that bug
     * also presented as "the thinking button does nothing".
     */
    const blamesThinking = /thinking/i.test(detail);
    const blamesNothing = /Request contains an invalid argument/i.test(detail);
    if (res.status !== 400 || !(blamesThinking || blamesNothing)) break;
    if (i === ladder.length - 1) break;
    console.warn(
      `[gemini] ${JSON.stringify(thinkingConfig)} refused, trying ${JSON.stringify(ladder[i + 1])}:`,
      detail.replace(/\s+/g, ' ').slice(0, 140)
    );
  }
  if (!res.ok) {
    // Long enough to keep Google's `details` block, which is the only part that
    // ever names the offending field.
    throw new Error(`${res.status}: ${detail.replace(/\s+/g, ' ').slice(0, 400)}`);
  }

  let callSeq = 0;
  for await (const payload of sseEvents(res)) {
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;  // a keep-alive or a partial frame — the next event carries it
    }
    if (chunk.promptFeedback?.blockReason) {
      throw new Error(`prompt blocked (${chunk.promptFeedback.blockReason})`);
    }
    const candidate = chunk.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.functionCall) {
        // Gemini does not id its calls; the loop needs one to pair results back.
        yield {
          type: 'call',
          id: `${part.functionCall.name}-${callSeq++}`,
          name: part.functionCall.name,
          args: part.functionCall.args ?? {},
          /**
           * An encrypted digest of the reasoning that led to this call. Gemini 3
           * requires it back, unmodified, on the functionCall part when the
           * transcript is replayed — without it the next request is refused
           * outright ("Function call is missing a thought_signature…"), which is
           * a 400 in the middle of a turn that had already started well.
           * Docs: https://ai.google.dev/gemini-api/docs/thought-signatures
           */
          thoughtSignature: part.thoughtSignature,
        };
      } else if (typeof part.text === 'string' && part.text) {
        yield { type: part.thought ? 'thinking' : 'delta', text: part.text };
      }
    }
    if (candidate?.finishReason) yield { type: 'finish', reason: candidate.finishReason };
  }
}
