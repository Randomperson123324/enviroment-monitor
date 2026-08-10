/**
 * Provider settings resolution + runtime model discovery.
 *
 * No model id is baked into the app: when a provider has no configured model,
 * we ask its own list endpoint which one to use. That way a new model on the
 * local endpoint, or a new Gemini release, shows up with no code change.
 *
 * Resolution order per request:
 *   Dev-Settings header → env var → auto-discovered → throw (chain falls through)
 */
import config from '@/config';
import * as openaiCompat from '@/lib/ai/providers/openai-compat';
import * as gemini from '@/lib/ai/providers/gemini';

export const PROVIDERS = {
  local: { impl: openaiCompat, label: 'Local' },
  gemini: { impl: gemini, label: 'Google AI Studio' },
};

/** Config merged with the browser's x-ai-* overrides (blank override = keep config). */
export function providerSettings(id, overrides = {}) {
  const base = config.ai[id];
  if (!base) throw new Error(`unknown AI provider "${id}"`);
  const o = overrides[id] ?? {};
  return {
    ...base,
    baseUrl: o.baseUrl || base.baseUrl,
    model: o.model || base.model,
    apiKey: o.apiKey || base.apiKey,
  };
}

/** A provider is usable when it has an endpoint and, where required, a key. */
export function providerReady(id, overrides = {}) {
  const s = providerSettings(id, overrides);
  if (!s.baseUrl) return false;
  return id === 'gemini' ? Boolean(s.apiKey) : true;
}

/** The configured order, filtered to providers this app knows about. */
export function providerOrder(overrides = {}) {
  const order = overrides.order?.length ? overrides.order : config.ai.order;
  return order.filter((id) => PROVIDERS[id]);
}

const modelCache = new Map();

/**
 * Live model list for a provider, cached briefly (endpoint+key scoped).
 *
 * `timeoutMs` caps this call the same way the chain caps a generate: discovery
 * runs *before* the generate, so an endpoint that accepts the connection and
 * never answers would otherwise spend the whole request here — the generate cap
 * alone left a two-minute stall in front of it.
 */
export async function listModels(id, overrides = {}, { timeoutMs } = {}) {
  const s = providerSettings(id, overrides);
  const key = `${id}|${s.baseUrl}|${s.apiKey ? 'k' : ''}`;
  const hit = modelCache.get(key);
  if (hit && Date.now() - hit.at < config.ai.modelCacheMs) return hit.models;

  const models = await PROVIDERS[id].impl.listModels({
    baseUrl: s.baseUrl,
    apiKey: s.apiKey,
    timeoutMs: timeoutMs ? Math.min(s.timeoutMs, timeoutMs) : s.timeoutMs,
  });
  modelCache.set(key, { at: Date.now(), models });
  return models;
}

/**
 * Models worth trying, best first, for recovering from a refused one.
 *
 * Order matters because a provider's own list order is not "what works": Google
 * lists its retired names first, so the first alternative after a refused pin was
 * refused too. A `-latest` alias is published to mean "the current one", which is
 * exactly the question being asked here; after those, a model the endpoint reports
 * as loaded beats one it would have to cold-start.
 */
export async function modelCandidates(id, overrides = {}, { exclude, timeoutMs } = {}) {
  const models = (await listModels(id, overrides, { timeoutMs })).filter((m) => m.id !== exclude);
  const rank = (m) => (/latest/i.test(m.id) ? 0 : m.ready ? 1 : 2);
  return [...models].sort((a, b) => rank(a) - rank(b)).map((m) => m.id);
}

/**
 * The model id to actually call — configured value, else discovered.
 *
 * `forceDiscover` ignores the configured value and asks the provider. Used to
 * recover when a pinned model has been retired: Google answers 404 "no longer
 * available to new users" for a name that still appears in its own list, and the
 * only way out is to pick from what the key can actually call.
 */
export async function resolveModel(id, overrides = {}, { forceDiscover = false, timeoutMs } = {}) {
  const s = providerSettings(id, overrides);
  if (s.model && !forceDiscover) return s.model;

  const models = await listModels(id, overrides, { timeoutMs });
  // Prefer one the endpoint reports as already loaded: picking an unloaded model
  // makes llama-swap evict and cold-start, turning a chat reply into a minute.
  // When recovering from a retired model, skip the one that just failed.
  const usable = forceDiscover && s.model ? models.filter((m) => m.id !== s.model) : models;
  const picked = usable.find((m) => m.ready) ?? usable[0];
  if (!picked) throw new Error(`no models available at ${s.baseUrl}`);
  return picked.id;
}
