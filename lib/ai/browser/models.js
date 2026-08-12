/**
 * Identity helpers for whichever model the browser engine has been pointed at.
 *
 * There is no built-in list any more. Two Qwen3 builds used to be hardcoded here
 * with hand-copied sizes and VRAM figures, which meant the app's idea of what it
 * could run drifted from web-llm's every time either side moved. The catalogue is
 * now web-llm's own `prebuiltAppConfig`, browsed through Hugging Face — see
 * `lib/ai/browser/catalog.js` — and nothing on this side names a model.
 */

/**
 * What the pane and the chat show about the chosen model. `meta` is what the
 * picker saved when it was chosen (label, measured download size), so neither
 * has to go back to the network to describe it. No id chosen yet → null, which
 * every caller has to handle: "no model yet" is a real state now, not an
 * impossible one.
 */
export function getBrowserModelInfo(id, meta = null) {
  if (!id) return null;
  return {
    id,
    label: meta?.label || id.replace(/-MLC$/, '').replace(/-/g, ' '),
    sizeText: meta?.sizeText || '',
    vramMB: meta?.vramMB ?? 0,
  };
}

/**
 * The q4f32 build of a q4f16 id, for GPUs without the WebGPU feature
 * `shader-f16`: those fail to compile the f16 shaders, and only *after* the whole
 * model has downloaded. MLC names the two builds of one model identically apart
 * from the quantisation, so the twin is a string swap — but it is only used once
 * web-llm confirms it ships that build (see engine.js).
 */
export function f32SiblingId(id) {
  return /q4f16_1/.test(id) ? id.replace('q4f16_1', 'q4f32_1') : null;
}

function f16SiblingId(id) {
  return /q4f32_1/.test(id) ? id.replace('q4f32_1', 'q4f16_1') : null;
}

/**
 * Every variant id of one model. Used when deleting: a machine that was moved to
 * the f32 build may still be holding gigabytes of the f16 one it can never run.
 */
export function variantIds(id) {
  const twin = f32SiblingId(id) ?? f16SiblingId(id);
  return twin ? [id, twin] : [id];
}
