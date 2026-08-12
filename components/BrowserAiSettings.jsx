'use client';

/**
 * The on-device model's life cycle: pick, download, delete. One pane of the
 * settings dialog.
 *
 * *Choosing* the browser engine is not here — it sits in the assistant pane next
 * to the provider priority, because both answer the same question ("who answers
 * my questions") and splitting them across two panes made the priority list look
 * like it applied to the browser model too. This pane is about the weights.
 *
 * Ported from StreeFlood's `engine-settings.tsx`, GPU path only. The details that
 * look like clutter each answer a question the user would otherwise have to guess
 * at: a 2.5 GB download needs its size stated before it starts, delete asks twice
 * because re-downloading is slow, and the GPU line is the only explanation for
 * why a machine was quietly moved to the larger q4f32 build.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, HardDrive, Search, Trash2, TriangleAlert } from 'lucide-react';
import { repoSizeBytes, searchModels } from '@/lib/ai/browser/catalog';
import { useLang } from '@/hooks/useLang';

function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

/**
 * The Hugging Face catalogue: every MLC build `mlc-ai` publishes, marked with
 * whether this version of web-llm has a compiled WebGPU library for it. The ones
 * it does not are still listed — a model missing without explanation reads as a
 * bug in the search, and "this build has no WebGPU library" is the actual answer.
 *
 * Opening this list is what pulls web-llm into the page (catalog.js imports it
 * dynamically for the runnable check), which is why the search sits behind a
 * button rather than loading with the pane.
 */
function ModelSearch({ ai, onPick }) {
  const { t } = useLang();
  const [query, setQuery] = useState('');
  const [state, setState] = useState('idle');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState('');
  const abortRef = useRef(null);

  const run = useCallback(async (q) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState('loading');
    setError('');
    try {
      setResults(await searchModels({ query: q, signal: ctrl.signal }));
      setState('done');
    } catch (e) {
      if (e.name === 'AbortError') return;
      setError(e.message);
      setState('failed');
    }
  }, []);

  // The empty query is the useful first screen: the most downloaded builds, with
  // the runnable ones on top.
  useEffect(() => {
    void run('');
    return () => abortRef.current?.abort();
  }, [run]);

  // Typing searches on its own — a search button would be a second thing to
  // press for something that costs one request.
  useEffect(() => {
    const id = setTimeout(() => void run(query), 350);
    return () => clearTimeout(id);
  }, [query, run]);

  /**
   * Choosing costs one more request: web-llm's config states VRAM, which is not
   * the download size, and the size is the number someone about to spend their
   * data needs. A repo that will not answer still gets chosen — without the size.
   */
  const choose = async (m) => {
    setPicking(m.id);
    let sizeText = '';
    try {
      sizeText = formatBytes(await repoSizeBytes(m.repo));
    } catch {
      // Offline or rate-limited: the pick is still valid, just unmeasured.
    }
    setPicking('');
    onPick(m, { label: m.label, sizeText, vramMB: m.vramMB });
  };

  return (
    <div className="bai-search">
      <div className="bai-search-box">
        <Search size={13} strokeWidth={2.2} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('bai.searchPlaceholder')}
          aria-label={t('bai.searchLabel')}
        />
      </div>

      {state === 'loading' && <p className="bai-note">{t('bai.searching')}</p>}
      {state === 'failed' && <p className="bai-note bad">{t('bai.searchFailed', { msg: error })}</p>}
      {state === 'done' && results.length === 0 && <p className="bai-note">{t('bai.searchEmpty')}</p>}

      <div className="bai-results">
        {results.map((m) => (
          <button
            key={m.id}
            className={`bai-result ${m.id === ai.modelId ? 'on' : ''} ${m.runnable ? '' : 'off'}`}
            disabled={!m.runnable || picking === m.id}
            onClick={() => choose(m)}
            title={m.repo}
          >
            <span className="bai-result-name">
              {m.label}
              {m.id === ai.modelId && <Check size={12} strokeWidth={2.6} aria-hidden />}
            </span>
            <span className="bai-result-facts">
              {m.runnable
                ? [
                    m.vramMB ? t('bai.vram', { mb: m.vramMB }) : '',
                    m.contextWindow ? t('bai.ctx', { n: m.contextWindow }) : '',
                    t('bai.downloadsCount', { n: m.downloads.toLocaleString() }),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : t('bai.notRunnable')}
            </span>
          </button>
        ))}
      </div>
      <p className="bai-note">{t('bai.searchNote')}</p>
    </div>
  );
}

export default function BrowserAiSettings({ ai }) {
  const { t } = useLang();
  const [storage, setStorage] = useState(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  // Opened on demand, and left open once a model came from it — the two
  // recommended buttons then no longer describe what is selected.
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    void ai.getStorageEstimate().then(setStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDisk = ai.status.phase === 'cached' || ai.status.phase === 'ready';

  const handleDelete = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setDeleteArmed(false);
    await ai.removeModel();
    void ai.getStorageEstimate().then(setStorage);
  };

  if (ai.webgpu === false) return <p className="bai-warn">{t('bai.noWebgpu')}</p>;

  // Shown whatever the engine choice is: the model can be fetched ahead of time,
  // and a first question that starts a 2.5 GB download is a bad moment to
  // discover the option existed.
  return (
    <div className="bai-body">
      <div className="bai-label">{t('bai.model')}</div>
      {ai.models.map((m) => (
        <button
          key={m.id}
          className={`bai-model ${m.id === ai.modelId ? 'on' : ''}`}
          onClick={() => ai.setModel(m.id)}
        >
          <span className="bai-model-name">{m.label}</span>
          <span className="bai-model-size">{m.sizeText}</span>
          <span className="bai-model-desc">{t(`bai.desc.${m.descKey}`)}</span>
        </button>
      ))}

      {/* A model that came from the search is not one of the two buttons above,
          so it needs its own row — otherwise nothing on screen says what is
          selected. */}
      {ai.model?.fromSearch && (
        <button className="bai-model on" onClick={() => setSearchOpen(true)}>
          <span className="bai-model-name">{ai.model.label}</span>
          <span className="bai-model-size">{ai.model.sizeText}</span>
          <span className="bai-model-desc">{t('bai.fromSearch')}</span>
        </button>
      )}

      {searchOpen ? (
        <ModelSearch
          ai={ai}
          onPick={(m, info) => ai.setModel(m.id, info)}
        />
      ) : (
        <button className="bai-btn wide" onClick={() => setSearchOpen(true)}>
          <Search size={13} strokeWidth={2.2} aria-hidden />
          {t('bai.searchOpen')}
        </button>
      )}

      {ai.f16Ok === false && (
        <p className="bai-warn">
          <TriangleAlert size={12} strokeWidth={2.2} aria-hidden /> {t('bai.noF16')}
        </p>
      )}

      <label className="bai-switch">
        <input
          type="checkbox"
          checked={ai.sendContext}
          onChange={(e) => ai.setSendContext(e.target.checked)}
        />
        <span>
          {t('bai.sendContext')}
          <em>{t('bai.sendContextNote')}</em>
        </span>
      </label>

      <div className="bai-actions">
        {ai.status.phase === 'downloading' ? (
          <div className="bai-progress">
            <div className="bai-bar" style={{ width: `${ai.status.progress ?? 0}%` }} />
            <span>{t('bai.downloading', { pct: ai.status.progress ?? 0 })}</span>
          </div>
        ) : (
          <button className="bai-btn" onClick={() => ai.loadModel()}>
            <Download size={13} strokeWidth={2.2} aria-hidden />
            {onDisk ? t('bai.load') : t('bai.download', { size: ai.model.sizeText })}
          </button>
        )}

        {onDisk && ai.status.phase !== 'downloading' && (
          <button className={`bai-btn danger ${deleteArmed ? 'armed' : ''}`} onClick={handleDelete}>
            <Trash2 size={13} strokeWidth={2.2} aria-hidden />
            {deleteArmed ? t('bai.deleteSure') : t('bai.delete')}
          </button>
        )}
      </div>

      {ai.status.phase === 'ready' && <p className="bai-note ok">{t('bai.ready')}</p>}
      {ai.status.phase === 'error' && (
        <p className="bai-note bad">{t('bai.failed', { msg: ai.status.message ?? '' })}</p>
      )}

      <div className="bai-facts">
        {ai.gpuInfo === undefined && <span>{t('bai.checkingGpu')}</span>}
        {ai.gpuInfo === null && <span>{t('bai.noAdapter')}</span>}
        {ai.gpuInfo && (
          <span>
            {t('bai.gpu', {
              vendor: ai.gpuInfo.vendor || '?',
              arch: ai.gpuInfo.architecture || '?',
              f16: ai.gpuInfo.f16 ? 'f16' : 'f32',
            })}
          </span>
        )}
        {storage && (
          <span>
            <HardDrive size={11} strokeWidth={2.2} aria-hidden />{' '}
            {t('bai.storage', {
              used: formatBytes(storage.usage),
              quota: formatBytes(storage.quota),
            })}
          </span>
        )}
      </div>
    </div>
  );
}
