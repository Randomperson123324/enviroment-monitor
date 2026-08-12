'use client';

/**
 * The Hugging Face side of the on-device model picker.
 *
 * The catalogue is a join of two sources, and both halves are needed:
 *
 * - **Hugging Face** is the index. `mlc-ai` publishes the MLC conversions there,
 *   so a search over that account is a search over everything the runtime could
 *   ever load, with the download counts and dates that make one build easier to
 *   choose than another.
 * - **web-llm's own `prebuiltAppConfig`** is the gate. Running a model in the
 *   browser needs more than weights: it needs a WebGPU shader library compiled
 *   for that architecture and quantisation, pinned to this exact version of
 *   web-llm. A repo with no matching entry is real, downloadable, and will not
 *   run here — so it is listed and clearly marked rather than quietly hidden,
 *   because "why can't I pick this one" deserves an answer on screen.
 *
 * The web-llm import is dynamic and only happens when this pane is opened: the
 * library is ~5 MB and nobody browsing the dashboard should pay for it.
 */

const HF_API = 'https://huggingface.co/api/models';
/** Who publishes the MLC builds web-llm can run. */
const HF_AUTHOR = 'mlc-ai';

let runnablePromise = null;

/** model_id → what this build of web-llm knows about it. */
export function runnableCatalog() {
  runnablePromise ??= import('@mlc-ai/web-llm').then((webllm) => {
    const map = new Map();
    for (const m of webllm.prebuiltAppConfig?.model_list ?? []) {
      map.set(m.model_id, {
        id: m.model_id,
        repo: String(m.model ?? '').replace('https://huggingface.co/', ''),
        vramMB: Math.round(m.vram_required_MB ?? 0),
        lowResource: Boolean(m.low_resource_required),
        contextWindow: m.overrides?.context_window_size ?? 0,
      });
    }
    return map;
  });
  return runnablePromise;
}

/** 'Qwen3-4B-q4f16_1-MLC' → 'Qwen3 4B · q4f16_1' */
export function prettyModelName(id) {
  const base = String(id).replace(/-MLC$/, '');
  const m = /^(.*?)-(q[0-9]f[0-9]+(?:_[0-9])?)$/.exec(base);
  const name = (m ? m[1] : base).replace(/-/g, ' ');
  return m ? `${name} · ${m[2]}` : name;
}

/**
 * Search the MLC builds on Hugging Face. Returns runnable ones first: a list
 * sorted purely by downloads buries the models this browser can actually load
 * under a dozen it cannot.
 */
export async function searchModels({ query = '', limit = 40, signal } = {}) {
  const params = new URLSearchParams({
    author: HF_AUTHOR,
    sort: 'downloads',
    direction: '-1',
    limit: String(limit),
  });
  if (query.trim()) params.set('search', query.trim());

  const [res, runnable] = await Promise.all([
    fetch(`${HF_API}?${params}`, { signal, cache: 'no-store' }),
    runnableCatalog(),
  ]);
  if (!res.ok) throw new Error(`Hugging Face ${res.status}`);
  const repos = await res.json();

  const models = repos.map((r) => {
    const id = String(r.id ?? '').split('/').pop();
    const known = runnable.get(id);
    return {
      id,
      repo: r.id,
      label: prettyModelName(id),
      downloads: r.downloads ?? 0,
      likes: r.likes ?? 0,
      updated: r.createdAt ?? '',
      runnable: Boolean(known),
      vramMB: known?.vramMB ?? 0,
      lowResource: known?.lowResource ?? false,
      contextWindow: known?.contextWindow ?? 0,
    };
  });

  return models.sort((a, b) => b.runnable - a.runnable || b.downloads - a.downloads);
}

/**
 * What the download will actually cost, summed from the repo's files. Worth one
 * extra request for the model someone is about to commit gigabytes to — the
 * VRAM figure in web-llm's config answers a different question.
 */
export async function repoSizeBytes(repo, signal) {
  const res = await fetch(`${HF_API}/${repo}/tree/main?recursive=true`, {
    signal,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Hugging Face ${res.status}`);
  const files = await res.json();
  return files.reduce((n, f) => n + (f.lfs?.size ?? f.size ?? 0), 0);
}
