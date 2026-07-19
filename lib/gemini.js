/**
 * Gemini REST client (generateContent, v1beta).
 * Docs: https://ai.google.dev/api/generate-content
 * The per-request key may be overridden by the X-Gemini-Key header (browser settings).
 */
import config from '@/config';
import { MSG, fill } from '@/config/messages.th';

export function resolveGeminiKey(overrideKey) {
  return (overrideKey || '').trim() || config.gemini.apiKey;
}

export function geminiEnabled(overrideKey) {
  return Boolean(resolveGeminiKey(overrideKey));
}

async function generateContent({ key, contents, systemInstruction, jsonOutput = false }) {
  const { baseUrl, model, timeoutMs, maxOutputTokens } = config.gemini;
  const url = `${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents,
    generationConfig: {
      maxOutputTokens,
      ...(jsonOutput ? { responseMimeType: 'application/json' } : {}),
    },
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {}),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}

/** Strip markdown fences and parse JSON defensively. */
function parseJsonLoose(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in Gemini output');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Ask Gemini for {summary, recommendations[{level,text}]} about a reading.
 * Returns null-safe parsed object; throws on transport/parse failure.
 */
export async function geminiAnalyze(reading, summaryLine, overrideKey) {
  const key = resolveGeminiKey(overrideKey);
  const prompt = `${fill(MSG.analyze.prompt, { maxRecs: MSG.analyze.maxRecs })}\n\n${summaryLine}`;
  const text = await generateContent({
    key,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    jsonOutput: true,
  });
  const parsed = parseJsonLoose(text);
  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
        .filter((r) => r && typeof r.text === 'string')
        .slice(0, MSG.analyze.maxRecs)
        .map((r) => ({ level: r.level || 'info', text: r.text }))
    : [];
  return { summary: typeof parsed.summary === 'string' ? parsed.summary : '', recommendations };
}

/** Chat with sensor context. history: [{role:'user'|'assistant', content}] */
export async function geminiChat({ message, history = [], contextLine, overrideKey }) {
  const key = resolveGeminiKey(overrideKey);
  const turns = history
    .slice(-config.gemini.maxHistoryTurns)
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content ?? '') }],
    }));
  return generateContent({
    key,
    systemInstruction: `${MSG.chat.context}\n${contextLine}`,
    contents: [...turns, { role: 'user', parts: [{ text: message }] }],
  });
}
