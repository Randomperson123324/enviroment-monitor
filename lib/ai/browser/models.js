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

export function getBrowserModelInfo(id) {
  return (
    BROWSER_MODELS.find((m) => m.id === id) ??
    Object.values(F32_FALLBACKS).find((m) => m.id === id) ??
    BROWSER_MODELS[0]
  );
}

/**
 * Every variant id of one model. Used when deleting: a machine that switched to
 * the f32 fallback may still have gigabytes of the f16 build in cache.
 */
export function variantIds(id) {
  for (const [f16Id, f32] of Object.entries(F32_FALLBACKS)) {
    if (id === f16Id || id === f32.id) return [f16Id, f32.id];
  }
  return [id];
}
