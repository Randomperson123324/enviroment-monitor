'use client';

/**
 * WebLLM engine, running the model in this browser on the GPU (WebGPU).
 * Ported from StreeFlood's `lib/ai/local/engine.ts` — the GPU path only.
 *
 * Every runtime reference to @mlc-ai/web-llm is a dynamic import: the library is
 * ~5 MB, and a user who never turns the browser engine on should not pay for it
 * in the initial bundle, nor have SSR touch it at all.
 *
 * ── Why the model runs on the main thread ────────────────────────────────────
 * A Web Worker that loads its script over the network needs that script's own
 * response to declare COEP (the spec's "check a global object's embedder policy"
 * step). On a cross-origin-isolated page the worker then fails to construct —
 * and when that happens WebLLM waits forever for a message that never comes: no
 * throw, no error, just a progress bar frozen at 0%. The main thread loads no
 * such cross-boundary script, so it is not coupled to the host's headers.
 *
 * The cost is real: inference runs on the main thread. WebGPU work is async so
 * the page does not freeze, but it is visibly less smooth than a worker would be.
 */

import { f32SiblingId } from '@/lib/ai/browser/models';

let webllmPromise = null;
let enginePromise = null;
let loadedModelId = null;
/** WebLLM generates one completion at a time; this serialises overlapping asks. */
let generationQueue = Promise.resolve();

function loadWebLLM() {
  webllmPromise ??= import('@mlc-ai/web-llm');
  return webllmPromise;
}

export function isWebGpuAvailable() {
  return typeof navigator !== 'undefined' && Boolean(navigator.gpu);
}

let gpuInfoPromise = null;

/**
 * The adapter's own description of the GPU — `null` when no usable adapter
 * exists. WebGPU exposes no dedicated/shared memory split, so `maxBufferBytes`
 * is the closest thing to "how much VRAM will the browser actually hand over".
 */
export function getWebGpuInfo() {
  gpuInfoPromise ??= (async () => {
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) return null;
      return {
        vendor: adapter.info?.vendor ?? '',
        architecture: adapter.info?.architecture ?? '',
        f16: adapter.features.has('shader-f16'),
        maxBufferBytes: adapter.limits?.maxBufferSize ?? 0,
      };
    } catch {
      return null;
    }
  })();
  return gpuInfoPromise;
}

/**
 * `navigator.gpu` existing does not mean WebGPU works: on some machines
 * requestAdapter returns null (card blocklisted, software renderer), so the
 * check has to go all the way to an adapter.
 */
export function hasWebGpuAdapter() {
  return getWebGpuInfo().then((info) => info !== null);
}

export function supportsShaderF16() {
  return getWebGpuInfo().then((info) => info?.f16 ?? false);
}

/**
 * Swap in the q4f32 build when this GPU has no f16 support. Done here, the one
 * place before an engine is created, so a caller passing an f16 id before the
 * UI's own check has resolved still gets a model that can compile.
 */
export async function resolveModelId(modelId) {
  if (await supportsShaderF16()) return modelId;

  // MLC names the two builds of a model alike: swap the quantisation, and take
  // the result only if this web-llm actually ships a compiled library for it.
  const sibling = f32SiblingId(modelId);
  if (!sibling) return modelId;
  const webllm = await loadWebLLM();
  const known = webllm.prebuiltAppConfig?.model_list?.some((m) => m.model_id === sibling);
  return known ? sibling : modelId;
}

export async function getEngine(requestedModelId, onProgress) {
  const modelId = await resolveModelId(requestedModelId);
  const webllm = await loadWebLLM();

  if (enginePromise) {
    const engine = await enginePromise;
    if (loadedModelId !== modelId) {
      // Only claim the new id once the reload succeeded. If it fails — not
      // enough VRAM for the bigger model, say — the next call must try again
      // rather than hand back an engine in an unknown state.
      loadedModelId = null;
      await engine.reload(modelId);
      loadedModelId = modelId;
    }
    return engine;
  }

  loadedModelId = modelId;
  enginePromise = webllm.CreateMLCEngine(modelId, {
    initProgressCallback: (report) => onProgress?.(report.progress, report.text),
  });
  try {
    return await enginePromise;
  } catch (err) {
    // Init failed (GPU too small, an incomplete download). Clear the singleton
    // so pressing the button again is a fresh attempt, not a cached failure.
    await unloadEngine();
    throw err;
  }
}

export function isEngineLoaded() {
  return enginePromise !== null;
}

export async function unloadEngine() {
  const pending = enginePromise;
  enginePromise = null;
  loadedModelId = null;
  try {
    const engine = await pending;
    await engine?.unload();
  } catch {
    // An engine that never finished initialising has nothing to unload.
  }
}

export async function hasModelCached(modelId) {
  if (!isWebGpuAvailable()) return false;
  const webllm = await loadWebLLM();
  return webllm.hasModelInCache(modelId);
}

export async function deleteModel(modelId) {
  await unloadEngine();
  const webllm = await loadWebLLM();
  await webllm.deleteModelAllInfoInCache(modelId);
}

/** Browser storage used vs granted — the model lives in that budget. */
export async function getStorageEstimate() {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usage: usage ?? 0, quota: quota ?? 0 };
}

export async function interrupt() {
  if (!enginePromise) return;
  const engine = await enginePromise;
  engine.interruptGenerate();
}

/** Serialise generations: two overlapping asks would corrupt each other's KV cache. */
export function enqueue(fn) {
  const run = generationQueue.then(fn, fn);
  generationQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
