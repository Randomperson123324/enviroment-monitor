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

/**
 * Adapt the shared request shape to whichever provider is being called.
 * `budgetMs` caps this attempt so the rest of the chain still gets a turn;
 * `forceDiscover` ignores a configured model that has just been rejected.
 */
async function callProvider(
  id,
  { systemInstruction, messages, jsonOutput },
  overrides,
  { budgetMs, forceDiscover } = {}
) {
  const s = providerSettings(id, overrides);
  const model = await resolveModel(id, overrides, { forceDiscover, timeoutMs: budgetMs });
  const common = {
    baseUrl: s.baseUrl,
    apiKey: s.apiKey,
    model,
    systemInstruction,
    jsonOutput,
    timeoutMs: budgetMs ? Math.min(s.timeoutMs, budgetMs) : s.timeoutMs,
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
/**
 * Does this failure mean "the model we asked for is unusable", as opposed to "the
 * provider is down"?
 *
 * Google answers 404 for a name it has retired for new keys — including names its
 * own list endpoint still returns. It also answers 429 "exceeded your current
 * quota" for those names, because a retired model's quota for a new key is zero:
 * the same cause wearing a rate-limit's clothes. Both are worth one attempt on a
 * model the key can actually call.
 */
function isModelRejected(message) {
  if (/^429\b/.test(message)) return true;
  return /^(404|400)\b/.test(message) && /model/i.test(message);
}

async function runChain(request, overrides, only) {
  // A pinned scope ignores the configured order outright: "on-device only" must
  // hold even when the user has set the chain to Gemini-first in Dev Settings.
  const order = only?.length ? only.filter((id) => PROVIDERS[id]) : providerOrder(overrides);
  const errors = [];

  // One budget for the whole chain, so a provider that hangs cannot spend the
  // request and leave the next one unasked.
  const deadline = Date.now() + config.ai.chainBudgetMs;
  const left = () => deadline - Date.now();

  for (const id of order) {
    if (!providerReady(id, overrides)) {
      errors.push(`${id}: not configured`);
      continue;
    }
    if (left() < config.ai.minAttemptMs) {
      errors.push(`${id}: skipped, no time left in the ${config.ai.chainBudgetMs / 1000}s budget`);
      continue;
    }
    try {
      return await callProvider(id, request, overrides, { budgetMs: left() });
    } catch (err) {
      console.warn(`[ai] ${id} failed:`, err.message);

      // A rejected model is worth one more try with whatever the provider lists —
      // but only when a model was pinned in the first place. Without a pin the
      // name came from the provider's own list, so a 429 there is a real rate
      // limit and retrying would just spend someone else's quota too.
      const pinned = Boolean(providerSettings(id, overrides).model);
      if (pinned && isModelRejected(err.message) && left() > config.ai.minAttemptMs) {
        try {
          const res = await callProvider(id, request, overrides, {
            budgetMs: left(),
            forceDiscover: true,
          });
          console.warn(`[ai] ${id} recovered on ${res.model} after the configured model was rejected`);
          return res;
        } catch (retryErr) {
          errors.push(`${id}: ${err.message} (retry on a discovered model: ${retryErr.message})`);
          continue;
        }
      }
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
