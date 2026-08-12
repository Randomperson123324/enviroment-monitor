'use client';

/**
 * Which engine the assistant uses, and the state of the model on this machine.
 * Ported from StreeFlood's `use-ai-engine.tsx`, GPU path only.
 *
 * Importing the engine module directly is fine: @mlc-ai/web-llm itself is a
 * dynamic import inside it, so nothing heavy loads until the browser engine is
 * actually used.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STORAGE } from '@/config/client';
import {
  BROWSER_MODELS,
  DEFAULT_BROWSER_MODEL_ID,
  F32_FALLBACKS,
  canonicalModelId,
  getBrowserModelInfo,
  variantIds,
} from '@/lib/ai/browser/models';
import {
  deleteModel,
  getEngine,
  getStorageEstimate,
  getWebGpuInfo,
  hasModelCached,
  isWebGpuAvailable,
  unloadEngine,
} from '@/lib/ai/browser/engine';

export default function useBrowserAi({ enabled = true } = {}) {
  const [kind, setKindState] = useState('server');
  /** Stored canonically as the f16 id; the variant to actually run is derived. */
  const [selectedId, setSelectedId] = useState(DEFAULT_BROWSER_MODEL_ID);
  const [f16Ok, setF16Ok] = useState(null);
  const [status, setStatus] = useState({ phase: 'idle' });
  const [webgpu, setWebgpu] = useState(null);
  const [gpuInfo, setGpuInfo] = useState(undefined);
  const [sendContext, setSendContextState] = useState(true);
  /** Guards against two loads at once (panel button + first message). */
  const loadRef = useRef(null);

  // No shader-f16 → every id must point at the q4f32 build, not just the one
  // getEngine resolves: the size shown and the cache check have to agree with
  // what will really be downloaded.
  const modelId = f16Ok === false ? (F32_FALLBACKS[selectedId]?.id ?? selectedId) : selectedId;
  const model = getBrowserModelInfo(modelId);
  const models = useMemo(
    () => (f16Ok === false ? BROWSER_MODELS.map((m) => F32_FALLBACKS[m.id] ?? m) : BROWSER_MODELS),
    [f16Ok]
  );

  useEffect(() => {
    const supported = isWebGpuAvailable();
    setWebgpu(supported);

    // The browser engine is the only thing here that can be unavailable outright,
    // so a stored preference for it is honoured only if this machine can run it.
    if (enabled && supported && window.localStorage.getItem(STORAGE.aiEngine) === 'browser') {
      setKindState('browser');
    }
    if (window.localStorage.getItem(STORAGE.aiSendContext) === 'false') setSendContextState(false);

    const stored = window.localStorage.getItem(STORAGE.aiBrowserModel);
    if (stored) {
      const canonical = canonicalModelId(stored);
      if (BROWSER_MODELS.some((m) => m.id === canonical)) setSelectedId(canonical);
    }
    if (supported) {
      void getWebGpuInfo().then((info) => {
        setGpuInfo(info);
        setF16Ok(info?.f16 ?? false);
      });
    }
  }, [enabled]);

  /** Is this model already on disk? Re-checked whenever the id changes. */
  const checkCache = useCallback(async () => {
    try {
      const cached = await hasModelCached(modelId);
      setStatus((prev) => {
        if (prev.phase === 'idle' && cached) return { phase: 'cached' };
        if (prev.phase === 'cached' && !cached) return { phase: 'idle' };
        return prev;
      });
    } catch {
      // Cannot read the cache — leaving it as idle costs only a redundant check.
    }
  }, [modelId]);

  // Checked whatever the engine is: the browser model can sit anywhere in the
  // chain, and the chat has to know whether reaching it means a load or a
  // multi-gigabyte download it must ask about first.
  useEffect(() => {
    void checkCache();
  }, [checkCache]);

  const setKind = useCallback((next) => {
    setKindState(next);
    window.localStorage.setItem(STORAGE.aiEngine, next);
  }, []);

  const setSendContext = useCallback((next) => {
    setSendContextState(next);
    window.localStorage.setItem(STORAGE.aiSendContext, String(next));
  }, []);

  const setModel = useCallback((id) => {
    // Never mid-download: the percentage on screen would start meaning a
    // different model than the one it is counting.
    if (loadRef.current) return;
    const canonical = canonicalModelId(id);
    if (!BROWSER_MODELS.some((m) => m.id === canonical)) return;
    setSelectedId(canonical);
    window.localStorage.setItem(STORAGE.aiBrowserModel, canonical);
    setStatus({ phase: 'idle' });
  }, []);

  const loadModel = useCallback(
    (onProgress) => {
      if (loadRef.current) return loadRef.current;

      const run = (async () => {
        setStatus((prev) => (prev.phase === 'ready' ? prev : { phase: 'downloading', progress: 0 }));
        try {
          await getEngine(modelId, (progress) => {
            const pct = Math.round(progress * 100);
            setStatus({ phase: 'downloading', progress: pct });
            onProgress?.(pct);
          });
          setStatus({ phase: 'ready' });
        } catch (err) {
          setStatus({ phase: 'error', message: err.message });
          throw err;
        } finally {
          loadRef.current = null;
        }
      })();
      loadRef.current = run;
      return run;
    },
    [modelId]
  );

  const removeModel = useCallback(async () => {
    // Every variant: a machine that fell back to q4f32 may still be holding the
    // f16 download it can never use.
    for (const id of variantIds(modelId)) await deleteModel(id);
    setStatus({ phase: 'idle' });
  }, [modelId]);

  const unload = useCallback(async () => {
    await unloadEngine();
    setStatus((prev) => (prev.phase === 'ready' ? { phase: 'cached' } : prev));
  }, []);

  return {
    kind,
    setKind,
    modelId,
    model,
    models,
    status,
    webgpu,
    gpuInfo,
    f16Ok,
    sendContext,
    setSendContext,
    setModel,
    loadModel,
    removeModel,
    unload,
    getStorageEstimate,
  };
}
