/**
 * Models the browser engine can run, ported from StreeFlood's on-device list.
 *
 * `id` must match `prebuiltAppConfig.model_list` of the installed
 * @mlc-ai/web-llm — the numbers below were read out of 0.2.84's own config, not
 * estimated, because a wrong VRAM figure shows up as a download that completes
 * and then fails to start.
 */

export const BROWSER_MODELS = [
  { id: 'Qwen3-4B-q4f16_1-MLC', label: 'Qwen3 4B', sizeText: '~2.5 GB', vramMB: 3432, descKey: 'quality' },
  { id: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 1.7B', sizeText: '~1.1 GB', vramMB: 2037, descKey: 'light' },
];

export const DEFAULT_BROWSER_MODEL_ID = BROWSER_MODELS[0].id;

/**
 * q4f32 builds for GPUs without the WebGPU feature `shader-f16`.
 *
 * The q4f16 shaders start with `enable f16;` and fail to compile on those cards
 * (GPUValidationError) — but only *after* the whole model has downloaded, which
 * is the worst possible moment to find out. Keyed by the f16 id it replaces.
 */
export const F32_FALLBACKS = {
  'Qwen3-4B-q4f16_1-MLC': {
    id: 'Qwen3-4B-q4f32_1-MLC', label: 'Qwen3 4B', sizeText: '~2.9 GB', vramMB: 4328, descKey: 'quality',
  },
  'Qwen3-1.7B-q4f16_1-MLC': {
    id: 'Qwen3-1.7B-q4f32_1-MLC', label: 'Qwen3 1.7B', sizeText: '~1.2 GB', vramMB: 2635, descKey: 'light',
  },
};

/** Any variant id → the f16 id, which is what gets stored and compared. */
export function canonicalModelId(id) {
  for (const [f16Id, f32] of Object.entries(F32_FALLBACKS)) {
    if (id === f32.id) return f16Id;
  }
  return id;
}

/**
 * The two above are the recommended pair, not the limit: anything in web-llm's
 * prebuilt list can be picked from the Hugging Face search (see catalog.js), and
 * those ids arrive here with no curated entry. `meta` is whatever the picker
 * saved about the chosen one — a label and a measured download size — so the
 * pane can describe it without going back to the network.
 */
export function getBrowserModelInfo(id, meta = null) {
  const known =
    BROWSER_MODELS.find((m) => m.id === id) ??
    Object.values(F32_FALLBACKS).find((m) => m.id === id);
  if (known) return known;
  if (!id) return BROWSER_MODELS[0];
  return {
    id,
    label: meta?.label || id.replace(/-MLC$/, '').replace(/-/g, ' '),
    sizeText: meta?.sizeText || '',
    vramMB: meta?.vramMB ?? 0,
    descKey: null,
    fromSearch: true,
  };
}

/**
 * Every variant id of one model. Used when deleting: a machine that switched to
 * the f32 fallback may still have gigabytes of the f16 build in cache.
 */
export function variantIds(id) {
  for (const [f16Id, f32] of Object.entries(F32_FALLBACKS)) {
    if (id === f16Id || id === f32.id) return [f16Id, f32.id];
  }
  // Same rule for a model picked from the search: MLC names the two builds of
  // one model identically apart from the quantisation, so the f32 twin of a
  // downloaded f16 build is worth deleting too.
  const twin = f32SiblingId(id) ?? f16SiblingId(id);
  return twin ? [id, twin] : [id];
}

/** The q4f32 build of a q4f16 id, for GPUs without shader-f16. Null if not that shape. */
export function f32SiblingId(id) {
  return /q4f16_1/.test(id) ? id.replace('q4f16_1', 'q4f32_1') : null;
}

function f16SiblingId(id) {
  return /q4f32_1/.test(id) ? id.replace('q4f32_1', 'q4f16_1') : null;
}
