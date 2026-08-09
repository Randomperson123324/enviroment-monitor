/**
 * Provider-agnostic AI entry points.
 *
 * Walks config.ai.order (local → gemini by default), returning the first
 * provider that answers and logging the ones that don't. When every provider
 * fails the callers fall back to the local rule engine in lib/analysis.js, so a
 * dead endpoint degrades the dashboard instead of breaking it.
 */
import config from '@/config';
import { MSG, fill } from '@/config/messages.th';
import { PROVIDERS, providerOrder, providerReady, providerSettings, resolveModel } from '@/lib/ai/discovery';

/**
 * Strip markdown fences and parse JSON defensively — local models fence their
 * output far more often than Gemini, even with response_format set.
 */
export function parseJsonLoose(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in the model output');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Adapt the shared request shape to whichever provider is being called. */
async function callProvider(id, { systemInstruction, messages, jsonOutput }, overrides) {
  const s = providerSettings(id, overrides);
  const model = await resolveModel(id, overrides);
  const common = {
    baseUrl: s.baseUrl,
    apiKey: s.apiKey,
    model,
    systemInstruction,
    jsonOutput,
    timeoutMs: s.timeoutMs,
    maxTokens: s.maxTokens,
  };

  const text =
    id === 'gemini'
      ? await PROVIDERS.gemini.impl.generate({
          ...common,
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(m.content ?? '') }],
          })),
        })
      : await PROVIDERS[id].impl.generate({ ...common, messages, thinking: s.thinking });

  return { text, provider: id, model };
}

/**
 * Try each configured provider in order; throw only when all of them fail.
 * `only` narrows the chain to specific providers — used by scopes that must not
 * silently fall back to a cloud model.
 */
async function runChain(request, overrides, only) {
  // A pinned scope ignores the configured order outright: "on-device only" must
  // hold even when the user has set the chain to Gemini-first in Dev Settings.
  const order = only?.length ? only.filter((id) => PROVIDERS[id]) : providerOrder(overrides);
  const errors = [];

  for (const id of order) {
    if (!providerReady(id, overrides)) {
      errors.push(`${id}: not configured`);
      continue;
    }
    try {
      return await callProvider(id, request, overrides);
    } catch (err) {
      console.warn(`[ai] ${id} failed:`, err.message);
      errors.push(`${id}: ${err.message}`);
    }
  }
  throw new Error(errors.join(' · ') || 'no AI provider configured');
}

/** Which providers could serve a request right now (for GET /api/config). */
export function aiStatus(overrides = {}) {
  const order = providerOrder(overrides);
  return { order, available: order.filter((id) => providerReady(id, overrides)) };
}

export function aiEnabled(overrides = {}) {
  return aiStatus(overrides).available.length > 0;
}

/**
 * Analyze a reading → { summary, recommendations[{level,text}], provider, model }.
 * Throws when no provider answers; callers keep their rule-engine fallback.
 */
export async function aiAnalyze({ reading, summaryLine, overrides = {} }) {
  const prompt = `${fill(MSG.analyze.prompt, { maxRecs: MSG.analyze.maxRecs })}\n\n${summaryLine}`;
  const { text, provider, model } = await runChain(
    { messages: [{ role: 'user', content: prompt }], jsonOutput: true },
    overrides
  );

  const parsed = parseJsonLoose(text);
  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
        .filter((r) => r && typeof r.text === 'string')
        .slice(0, MSG.analyze.maxRecs)
        .map((r) => ({ level: r.level || 'info', text: r.text }))
    : [];
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    recommendations,
    provider,
    model,
  };
}

/**
 * Free-form scope summary → { summary, recommendations[{level,text}], provider, model }.
 * Same JSON contract as aiAnalyze so every tab renders through one component.
 * `only` pins the provider chain (see runChain).
 */
export async function aiSummarize({ instruction, contextText, overrides = {}, only }) {
  const maxRecs = config.ai.summary.maxRecs;
  const prompt = `${instruction}\n\n${fill(MSG.scopes.jsonShape, { maxRecs })}\n\n${contextText}`;
  const { text, provider, model } = await runChain(
    { messages: [{ role: 'user', content: prompt }], jsonOutput: true },
    overrides,
    only
  );

  const parsed = parseJsonLoose(text);
  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
        .filter((r) => r && typeof r.text === 'string')
        .slice(0, maxRecs)
        .map((r) => ({ level: r.level || 'info', text: r.text }))
    : [];
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    recommendations,
    provider,
    model,
  };
}

/** Chat with the latest reading attached. history: [{role:'user'|'assistant', content}] */
export async function aiChat({ message, history = [], contextLine, overrides = {} }) {
  const turns = history.slice(-config.ai.maxHistoryTurns).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? ''),
  }));
  const { text, provider, model } = await runChain(
    {
      systemInstruction: `${MSG.chat.context}\n${contextLine}`,
      messages: [...turns, { role: 'user', content: message }],
    },
    overrides
  );
  return { reply: text, provider, model };
}
