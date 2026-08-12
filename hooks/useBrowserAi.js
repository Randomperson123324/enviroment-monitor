'use client';

/**
 * Which engine the assistant uses, and the state of the model on this machine.
 * Ported from StreeFlood's `use-ai-engine.tsx`, GPU path only.
 *
 * Importing the engine module directly is fine: @mlc-ai/web-llm itself is a
 * dynamic import inside it, so nothing heavy loads until the browser engine is
 * actually used.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { STORAGE } from '@/config/client';
import { f32SiblingId, getBrowserModelInfo, variantIds } from '@/lib/ai/browser/models';
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
  /**
   * Exactly what was picked from the search, stored verbatim. Empty until
   * someone picks: there is no built-in model to fall back on, and inventing a
   * default here would be the hardcoded list coming back through the side door.
   */
  const [selectedId, setSelectedId] = useState('');
  /** Label and measured size of a model chosen from the search, for the UI to show. */
  const [meta, setMeta] = useState(null);
  const [f16Ok, setF16Ok] = useState(null);
  const [status, setStatus] = useState({ phase: 'idle' });
  const [webgpu, setWebgpu] = useState(null);
  const [gpuInfo, setGpuInfo] = useState(undefined);
  const [sendContext, setSendContextState] = useState(true);
  /** Guards against two loads at once (panel button + first message). */
  const loadRef = useRef(null);

  // No shader-f16 → point at the q4f32 build here too, not only inside
  // getEngine: the cache check and the size on screen have to agree with what
  // will really be downloaded. Whether web-llm has that build is settled at load
  // time, where the catalogue is already in hand.
  const modelId = f16Ok === false ? (f32SiblingId(selectedId) ?? selectedId) : selectedId;
  const model = getBrowserModelInfo(modelId, meta);

  useEffect(() => {
    const supported = isWebGpuAvailable();
    setWebgpu(supported);

    // The browser engine is the only thing here that can be unavailable outright,
    // so a stored preference for it is honoured only if this machine can run it.
    if (enabled && supported && window.localStorage.getItem(STORAGE.aiEngine) === 'browser') {
      setKindState('browser');
    }
    if (window.localStorage.getItem(STORAGE.aiSendContext) === 'false') setSendContextState(false);

    // Any id web-llm ships a build for is allowed here — the search is what
    // validates, and an unknown-looking id is only unknown to *this file*.
    const stored = window.localStorage.getItem(STORAGE.aiBrowserModel);
    if (stored) setSelectedId(stored);
    try {
      const savedMeta = JSON.parse(window.localStorage.getItem(STORAGE.aiBrowserModelMeta) ?? 'null');
      if (savedMeta?.id) setMeta(savedMeta);
    } catch {
      // A half-written or hand-edited entry is not worth failing the pane over.
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
    if (!modelId) return;
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

  /**
   * `info` is what the picker learned from Hugging Face — the label it showed
   * and the size it measured — kept beside the id so the pane can describe the
   * choice without going back to the network.
   */
  const setModel = useCallback((id, info = null) => {
    // Never mid-download: the percentage on screen would start meaning a
    // different model than the one it is counting.
    if (loadRef.current) return;
    if (!id) return;
    setSelectedId(id);
    window.localStorage.setItem(STORAGE.aiBrowserModel, id);

    const next = info ? { id, ...info } : null;
    setMeta(next);
    if (next) window.localStorage.setItem(STORAGE.aiBrowserModelMeta, JSON.stringify(next));
    else window.localStorage.removeItem(STORAGE.aiBrowserModelMeta);

    setStatus({ phase: 'idle' });
  }, []);

  const loadModel = useCallback(
    (onProgress) => {
      if (loadRef.current) return loadRef.current;

      const run = (async () => {
        // Nothing picked yet: say so rather than asking web-llm to load ''.
        if (!modelId) {
          const err = new Error('no on-device model chosen');
          setStatus({ phase: 'error', message: err.message });
          throw err;
        }
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
