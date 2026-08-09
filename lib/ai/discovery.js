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

/** Live model list for a provider, cached briefly (endpoint+key scoped). */
export async function listModels(id, overrides = {}) {
  const s = providerSettings(id, overrides);
  const key = `${id}|${s.baseUrl}|${s.apiKey ? 'k' : ''}`;
  const hit = modelCache.get(key);
  if (hit && Date.now() - hit.at < config.ai.modelCacheMs) return hit.models;

  const models = await PROVIDERS[id].impl.listModels({
    baseUrl: s.baseUrl,
    apiKey: s.apiKey,
    timeoutMs: s.timeoutMs,
  });
  modelCache.set(key, { at: Date.now(), models });
  return models;
}

/** The model id to actually call — configured value, else discovered. */
export async function resolveModel(id, overrides = {}) {
  const s = providerSettings(id, overrides);
  if (s.model) return s.model;

  const models = await listModels(id, overrides);
  // Prefer one the endpoint reports as already loaded: picking an unloaded model
  // makes llama-swap evict and cold-start, turning a chat reply into a minute.
  const picked = models.find((m) => m.ready) ?? models[0];
  if (!picked) throw new Error(`no models available at ${s.baseUrl}`);
  return picked.id;
}
