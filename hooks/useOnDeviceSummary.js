'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { runBrowserSummary } from '@/lib/ai/browser/summary';
import { useLang } from '@/hooks/useLang';

/**
 * Summaries generated on this machine, one scope at a time, only when asked.
 *
 * One hook for all three tabs rather than one per tab: the engine can run a
 * single generation at a time anyway (see `enqueue` in lib/ai/browser/engine),
 * so a per-tab hook would be three copies of state that must never disagree
 * about which one is running.
 *
 * ── Why there is no polling here ─────────────────────────────────────────────
 * `useAiSummary` re-asks the server every 30 minutes and gets a cached answer
 * back, which costs nothing. This engine has no cache to hand back: every run
 * is the user's own GPU for anywhere from seconds to minutes, and a first run
 * may download gigabytes. So nothing here starts on a timer, on mount, or on a
 * tab switch — `run(scope)` is called by a button and by nothing else.
 */
export default function useOnDeviceSummary({ apiBase, deviceId, browserAi }) {
  const { t, lang } = useLang();
  /** scope → the last result on this device. */
  const [byScope, setByScope] = useState({});
  /** The scope generating right now, or null. */
  const [running, setRunning] = useState(null);
  const [status, setStatus] = useState('');
  const abortRef = useRef(null);

  // Results describe one device's readings; keeping them across a device switch
  // would show yesterday's room under today's name.
  useEffect(() => {
    setByScope({});
  }, [deviceId]);

  // A run outlives the component only if we let it: an unmount mid-generation
  // (tab switch, navigation) should stop pushing state into a dead card.
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (scope) => {
      if (running) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setRunning(scope);
      setStatus('');
      try {
        const data = await runBrowserSummary({
          scope,
          apiBase,
          deviceId,
          lang,
          modelId: browserAi.modelId,
          labels: {
            fetchingContext: t('bai.statusContext'),
            loadingModel: t('bai.statusLoading'),
            preparingModel: t('bai.statusPreparing'),
            analyzingPrompt: t('bai.statusPrefill'),
            thinking: t('bai.statusWaiting'),
            thinkingStatus: t('ai.thinkingLive'),
          },
          onStatus: setStatus,
          signal: ctrl.signal,
        });
        setByScope((prev) => ({ ...prev, [scope]: data }));
      } catch (err) {
        if (err.name === 'AbortError') return;
        // Failures are stored like results so the card can show them in place,
        // with the button still there to try again — the same contract the
        // server summaries use (`ok: false`), so the card needs no second path.
        setByScope((prev) => ({ ...prev, [scope]: { ok: false, error: err.message } }));
      } finally {
        if (abortRef.current === ctrl) {
          setRunning(null);
          setStatus('');
        }
      }
    },
    [apiBase, deviceId, lang, browserAi.modelId, running, t]
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return {
    get: (scope) => byScope[scope] ?? null,
    run,
    running,
    status,
    cancel,
  };
}
