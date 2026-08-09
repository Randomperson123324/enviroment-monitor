'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Settings } from 'lucide-react';
import { AI_ORDER_PRESETS, AI_SUMMARY_STYLES } from '@/config/client';
import { aiHeaders } from '@/lib/ai-client';
import { useLang } from '@/hooks/useLang';

/**
 * Model picker backed by GET /api/ai/models — the list comes from the provider
 * itself, so new models appear without a code change. Falls back to a free-text
 * box whenever the endpoint can't be reached (offline demo, wrong URL, no key).
 */
function ModelField({ label, provider, apiBase, headers, value, onChange, placeholder }) {
  const { t } = useLang();
  const [models, setModels] = useState([]);
  const [state, setState] = useState('loading');

  const load = useCallback(
    async (signal) => {
      setState('loading');
      try {
        const r = await fetch(`${apiBase}/api/ai/models?provider=${provider}`, {
          headers,
          cache: 'no-store',
          signal,
        });
        const d = await r.json();
        setModels(d.models ?? []);
        setState(d.models?.length ? 'ok' : 'empty');
      } catch (e) {
        if (e.name === 'AbortError') return;
        setModels([]);
        setState('empty');
      }
    },
    [apiBase, provider, headers]
  );

  // Debounced: the endpoint/key fields feed these headers, so a raw effect would
  // fire one request per keystroke.
  useEffect(() => {
    const ctrl = new AbortController();
    const id = setTimeout(() => load(ctrl.signal), 400);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [load]);

  // A previously saved model the endpoint no longer lists would otherwise render
  // as a blank select and be silently dropped on save.
  const options = models.some((m) => m.id === value) || !value
    ? models
    : [...models, { id: value, label: value, status: '' }];

  return (
    <div className="field">
      <label>{label}</label>
      {state === 'ok' ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{placeholder}</option>
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.status ? ` · ${t(`settings.modelStatus.${m.status}`)}` : ''}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={state === 'loading' ? t('settings.modelLoading') : placeholder}
        />
      )}
    </div>
  );
}

export default function SettingsModal({ settings, serverCfg, onSave, onClose }) {
  const { t } = useLang();
  const [apiBase, setApiBase] = useState(settings.apiBase);
  const [geminiKey, setGeminiKey] = useState(settings.geminiKey);
  const [aiOrder, setAiOrder] = useState(settings.aiOrder);
  const [aiLocalBase, setAiLocalBase] = useState(settings.aiLocalBase);
  const [aiLocalModel, setAiLocalModel] = useState(settings.aiLocalModel);
  const [aiGeminiBase, setAiGeminiBase] = useState(settings.aiGeminiBase);
  const [aiGeminiModel, setAiGeminiModel] = useState(settings.aiGeminiModel);
  const [aiRelay, setAiRelay] = useState(settings.aiRelay);
  const [aiSummaryStyle, setAiSummaryStyle] = useState(settings.aiSummaryStyle);
  const [pollSec, setPollSec] = useState(settings.pollMs / 1000);

  const ai = serverCfg.ai ?? {};
  // What the picker queries: whatever is typed here wins over the server's value.
  // Memoised on the values themselves — a fresh object each render would make
  // ModelField's effect re-fire on every keystroke elsewhere in the dialog.
  const probeHeaders = useMemo(
    () => aiHeaders({ aiLocalBase, aiGeminiBase, geminiKey }),
    [aiLocalBase, aiGeminiBase, geminiKey]
  );

  const save = () => {
    const min = serverCfg.pollMsMin / 1000;
    const max = serverCfg.pollMsMax / 1000;
    const sec = Math.min(max, Math.max(min, Number(pollSec) || serverCfg.pollMsDefault / 1000));
    onSave({
      apiBase: apiBase.trim(),
      geminiKey: geminiKey.trim(),
      aiOrder,
      aiLocalBase: aiLocalBase.trim(),
      aiLocalModel: aiLocalModel.trim(),
      aiGeminiBase: aiGeminiBase.trim(),
      aiGeminiModel: aiGeminiModel.trim(),
      aiRelay: aiRelay.trim(),
      aiSummaryStyle,
      pollMs: sec * 1000,
    });
  };

  return (
    <div
      className="modal-ov"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal-scroll">
        <h3 className="ai-float-title">
          <Settings size={18} strokeWidth={2.2} aria-hidden /> {t('settings.title')}
        </h3>

        <div className="field">
          <label>{t('settings.apiBase')}</label>
          <input
            type="text"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            placeholder={t('settings.apiBasePlaceholder')}
          />
        </div>
        <p className="field-hint">
          {t('settings.ingestHintPre')} <code>POST /api/ingest</code> {t('settings.ingestHintMid')}{' '}
          <code>temperature</code>, <code>humidity</code>, <code>gas_ppm</code>{' '}
          ({t('settings.ingestHintOr')} <code>temp</code>, <code>hum</code>, <code>gas</code>)
        </p>

        <h4 className="field-group">{t('settings.aiSection')}</h4>

        <div className="field">
          <label>{t('settings.aiSummaryStyle')}</label>
          <select value={aiSummaryStyle} onChange={(e) => setAiSummaryStyle(e.target.value)}>
            {AI_SUMMARY_STYLES.map((s) => (
              <option key={s.key} value={s.value}>
                {t(`settings.aiSummaryStyleOpt.${s.key}`)}
              </option>
            ))}
          </select>
        </div>
        <p className="field-hint">{t('settings.aiSummaryStyleHint')}</p>

        <div className="field">
          <label>{t('settings.aiOrder')}</label>
          <select value={aiOrder} onChange={(e) => setAiOrder(e.target.value)}>
            {AI_ORDER_PRESETS.map((p) => (
              <option key={p.key} value={p.value}>
                {t(`settings.aiOrderOpt.${p.key}`)}
              </option>
            ))}
          </select>
        </div>
        <p className="field-hint">
          {t('settings.aiServerOrder', { order: (ai.order ?? []).join(' → ') || '—' })}
        </p>

        <div className="field">
          <label>{t('settings.aiLocalBase')}</label>
          <input
            type="text"
            value={aiLocalBase}
            onChange={(e) => setAiLocalBase(e.target.value)}
            placeholder={ai.localBaseUrl || 'http://host:port'}
          />
        </div>
        <ModelField
          label={t('settings.aiLocalModel')}
          provider="local"
          apiBase={apiBase}
          headers={probeHeaders}
          value={aiLocalModel}
          onChange={setAiLocalModel}
          placeholder={t('settings.modelAuto')}
        />

        <div className="field">
          <label>{t('settings.geminiKey')}</label>
          <input
            type="password"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder={t('settings.geminiPlaceholder')}
          />
        </div>
        <div className="field">
          <label>{t('settings.aiGeminiBase')}</label>
          <input
            type="text"
            value={aiGeminiBase}
            onChange={(e) => setAiGeminiBase(e.target.value)}
            placeholder={ai.geminiBaseUrl || ''}
          />
        </div>
        <ModelField
          label={t('settings.aiGeminiModel')}
          provider="gemini"
          apiBase={apiBase}
          headers={probeHeaders}
          value={aiGeminiModel}
          onChange={setAiGeminiModel}
          placeholder={ai.geminiModel || t('settings.modelAuto')}
        />

        <div className="field">
          <label>{t('settings.aiRelay')}</label>
          <input
            type="text"
            value={aiRelay}
            onChange={(e) => setAiRelay(e.target.value)}
            placeholder={ai.relayConfigured ? t('settings.aiRelayServer') : 'https://example.vercel.app'}
          />
        </div>
        <p className="field-hint">{t('settings.aiRelayHint')}</p>

        <div className="field">
          <label>{t('settings.pollSec')}</label>
          <input
            type="number"
            min={serverCfg.pollMsMin / 1000}
            max={serverCfg.pollMsMax / 1000}
            value={pollSec}
            onChange={(e) => setPollSec(e.target.value)}
          />
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            {t('settings.cancel')}
          </button>
          <button className="btn btn-primary" onClick={save}>
            {t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
