'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  ChevronDown,
  Cloud,
  Cpu,
  Plug,
  Server,
  Settings,
  Share2,
  Sparkles,
} from 'lucide-react';
import { AI_SUMMARY_STYLES, aiChainFrom } from '@/config/client';
import { SENSORS } from '@/config/sensors';
import { aiHeaders } from '@/lib/ai-client';
import { useLang } from '@/hooks/useLang';
import AiEngineChain from '@/components/AiEngineChain';
import BrowserAiSettings from '@/components/BrowserAiSettings';

/** Canonical ingest field names, straight from the sensor definitions. */
const INGEST_FIELDS = SENSORS.map((s) => s.field).join(', ');

/**
 * The dialog's sections, in the order they appear down the left side.
 *
 * Split this way because the old single scroll made unrelated things neighbours:
 * the polling interval sat below four AI provider fields, and the Save button was
 * three screens down from the field you had just typed in. Each pane here answers
 * one question, and Save is now always on screen.
 *
 * Five of the six are about AI, so they sit inside one collapsible group rather
 * than as five siblings of "Server" — otherwise the list reads as though the
 * dashboard were mostly a settings screen for language models.
 *
 * Names live in config/i18n.js under `settings.sections.*`.
 */
const AI_SECTIONS = [
  { id: 'assistant', Icon: Bot },
  { id: 'device', Icon: Cpu },
  { id: 'local', Icon: Server },
  { id: 'gemini', Icon: Cloud },
  { id: 'relay', Icon: Share2 },
];

const SECTIONS = [{ id: 'connection', Icon: Server }, ...AI_SECTIONS];

const isAiSection = (id) => AI_SECTIONS.some((s) => s.id === id);

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

/** Shared shell for the two "test connection" rows. */
function TestRow({ onRun, state }) {
  const { t } = useLang();
  return (
    <p className="field-hint test-row">
      <button className="mini-btn" onClick={onRun} disabled={state?.level === 'busy'}>
        <Plug size={13} strokeWidth={2.4} aria-hidden /> {t('settings.test')}
      </button>
      {state ? (
        <span className={`test-result ${state.level}`} role="status" aria-live="polite">
          {state.text}
        </span>
      ) : null}
    </p>
  );
}

/**
 * Does the address in the API-server field actually serve this dashboard?
 *
 * Getting this field wrong breaks every request the page makes, and the app
 * kept showing the last reading it had managed to load, so the mistake was
 * invisible. Checking /api/health also rejects an address that answers HTTP but
 * is some other service (an AI endpoint, say) rather than this app.
 */
function ApiBaseTest({ apiBase }) {
  const { t } = useLang();
  const [state, setState] = useState(null);

  const run = async () => {
    setState({ level: 'busy', text: t('settings.testing') });
    try {
      const r = await fetch(`${apiBase}/api/health`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json().catch(() => ({}));
      if (d.ok !== true) throw new Error(t('settings.apiTestNotThisApp'));
      setState({
        level: d.supabase_ok ? 'ok' : 'warn',
        text: d.supabase_ok ? t('settings.apiTestOk') : t('settings.apiTestNoDb'),
      });
    } catch (e) {
      setState({ level: 'err', text: t('settings.testFail', { msg: e.message }) });
    }
  };

  return <TestRow onRun={run} state={state} />;
}

/**
 * On-demand reachability check for one provider.
 *
 * The model picker above silently degrades to a text box when an endpoint is
 * unreachable, which hides *why* — the difference between a wrong URL, a closed
 * port and a bad key was invisible until you read the server log. This asks the
 * same endpoint and shows the server's actual error instead.
 */
function ProviderTest({ provider, apiBase, headers }) {
  const { t } = useLang();
  const [state, setState] = useState(null);

  const run = async () => {
    setState({ level: 'busy', text: t('settings.testing') });
    try {
      const r = await fetch(`${apiBase}/api/ai/models?provider=${provider}`, {
        headers,
        cache: 'no-store',
      });
      const d = await r.json().catch(() => ({}));
      const message = d.error || (r.ok ? '' : `HTTP ${r.status}`);
      if (message) setState({ level: 'err', text: t('settings.testFail', { msg: message }) });
      else if (!d.models?.length) setState({ level: 'warn', text: t('settings.testEmpty') });
      else setState({ level: 'ok', text: t('settings.testOk', { n: d.models.length }) });
    } catch (e) {
      setState({ level: 'err', text: t('settings.testFail', { msg: e.message }) });
    }
  };

  return <TestRow onRun={run} state={state} />;
}

export default function SettingsModal({ settings, serverCfg, browserAi, onSave, onClose }) {
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
  const [section, setSection] = useState(SECTIONS[0].id);
  // Expanded on open: five of the six panes live in here, so collapsed the dialog
  // presents itself as having one topic. Collapsing is for getting them out of
  // the way, not the resting state.
  const [aiOpen, setAiOpen] = useState(true);

  /**
   * On a phone the section list is a horizontal strip, and the pane it controls
   * is below it: choosing "AI" expands four children that land off the right
   * edge, and expanding a list whose contents you cannot see is worse than not
   * expanding it. So the chosen chip is scrolled into view. `nearest` leaves the
   * strip alone whenever the chip is already visible, which is every time on
   * desktop, where the list is a column that does not scroll at all.
   */
  const navRef = useRef(null);
  useEffect(() => {
    // aria-selected, not `.on`: the AI group header is highlighted whenever one
    // of its children is showing, and it is the first match in the strip — so a
    // `.on` lookup scrolls to the group and leaves the chosen child off-screen,
    // which is the exact thing this is here to prevent.
    navRef.current
      ?.querySelector('.set-navbtn[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [section, aiOpen]);

  const ai = serverCfg.ai ?? {};
  // Nothing arranged yet shows the server's own order rather than an empty lane,
  // so the first drag starts from what is actually happening today.
  const chain = aiChainFrom(aiOrder, ai.order?.length ? ai.order : ['gemini']);
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
    // The hook keeps its own copy so it can check the model cache and warn about
    // WebGPU; the chain is what decides, so it is told rather than asked.
    browserAi?.setKind(chain[0] === 'browser' ? 'browser' : 'server');
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
      <div className="modal set-modal">
        <h3 className="ai-float-title set-title">
          <Settings size={18} strokeWidth={2.2} aria-hidden /> {t('settings.title')}
        </h3>

        {/* Tabs rather than links: each pane is part of one unsaved form, so
            moving between them must not be a navigation that could lose it. */}
        <div className="set-nav" ref={navRef} role="tablist" aria-label={t('settings.nav')}>
          <button
            role="tab"
            aria-selected={section === 'connection'}
            className={`set-navbtn ${section === 'connection' ? 'on' : ''}`}
            onClick={() => setSection('connection')}
          >
            <Server size={15} strokeWidth={2.1} aria-hidden />
            {t('settings.sections.connection')}
          </button>

          {/* One AI entry that expands. Collapsed, it still shows as active when
              one of its panes is the one on screen — otherwise the highlight
              disappears and nothing says where you are. */}
          <button
            className={`set-navbtn set-navgroup ${isAiSection(section) ? 'on' : ''}`}
            aria-expanded={aiOpen}
            onClick={() => {
              const next = !aiOpen;
              setAiOpen(next);
              // Expanding is also a request to see something: without this the
              // first click opens a list and leaves the pane on "Server".
              if (next && !isAiSection(section)) setSection(AI_SECTIONS[0].id);
            }}
          >
            <Sparkles size={15} strokeWidth={2.1} aria-hidden />
            {t('settings.sections.ai')}
            <ChevronDown
              size={14}
              strokeWidth={2.4}
              className={`set-caret ${aiOpen ? 'open' : ''}`}
              aria-hidden
            />
          </button>

          {aiOpen &&
            AI_SECTIONS.map(({ id, Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={section === id}
                className={`set-navbtn set-navchild ${section === id ? 'on' : ''}`}
                onClick={() => setSection(id)}
              >
                <Icon size={14} strokeWidth={2.1} aria-hidden />
                {t(`settings.sections.${id}`)}
              </button>
            ))}
        </div>

        <div className="set-pane" role="tabpanel">
          {section === 'connection' && (
            <>
              <div className="field">
                <label>{t('settings.apiBase')}</label>
                <input
                  type="text"
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  placeholder={t('settings.apiBasePlaceholder')}
                />
              </div>
              <ApiBaseTest apiBase={apiBase} />
              <p className="field-hint">
                {t('settings.ingestHintPre')} <code>POST /api/ingest</code>{' '}
                {t('settings.ingestHintMid')} <code>{INGEST_FIELDS}</code>
              </p>

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
              <p className="field-hint">
                {t('settings.pollHint', {
                  min: serverCfg.pollMsMin / 1000,
                  max: serverCfg.pollMsMax / 1000,
                })}
              </p>
            </>
          )}

          {section === 'assistant' && (
            <>
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

              {/* One control, two ways in: the buttons pick a single engine, the
                  lane arranges a fallback. Both write the same chain, which is
                  also what the x-ai-order header has always carried. */}
              <AiEngineChain
                chain={chain}
                browserAi={browserAi}
                onChange={(next) => setAiOrder(next.join(','))}
              />
              <p className="field-hint">
                {t('settings.aiServerOrder', { order: (ai.order ?? []).join(' → ') || '—' })}
              </p>
            </>
          )}

          {section === 'device' && (
            <>
              {/* Saved by the hook itself, not by this dialog's Save button:
                  downloading a model is an action, not a pending edit, and it
                  cannot sit half-applied waiting for a confirmation. */}
              <p className="field-hint">{t('settings.deviceHint')}</p>
              <p className="field-hint">{t('settings.deviceWhere')}</p>
              {browserAi ? <BrowserAiSettings ai={browserAi} /> : null}
            </>
          )}

          {section === 'local' && (
            <>
              <div className="field">
                <label>{t('settings.aiLocalBase')}</label>
                <input
                  type="text"
                  value={aiLocalBase}
                  onChange={(e) => setAiLocalBase(e.target.value)}
                  placeholder={ai.localBaseUrl || 'http://host:port'}
                />
              </div>
              <ProviderTest provider="local" apiBase={apiBase} headers={probeHeaders} />
              <ModelField
                label={t('settings.aiLocalModel')}
                provider="local"
                apiBase={apiBase}
                headers={probeHeaders}
                value={aiLocalModel}
                onChange={setAiLocalModel}
                // Name the model the server is pinned to, as the cloud pane
                // does: "automatic" stopped being the whole truth the moment
                // this deployment started shipping a default model.
                placeholder={ai.localModel || t('settings.modelAuto')}
              />
              <p className="field-hint">{t('settings.aiLocalHint')}</p>
            </>
          )}

          {section === 'gemini' && (
            <>
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
              <ProviderTest provider="gemini" apiBase={apiBase} headers={probeHeaders} />
              <ModelField
                label={t('settings.aiGeminiModel')}
                provider="gemini"
                apiBase={apiBase}
                headers={probeHeaders}
                value={aiGeminiModel}
                onChange={setAiGeminiModel}
                placeholder={ai.geminiModel || t('settings.modelAuto')}
              />
            </>
          )}

          {section === 'relay' && (
            <>
              <div className="field">
                <label>{t('settings.aiRelay')}</label>
                <input
                  type="text"
                  value={aiRelay}
                  onChange={(e) => setAiRelay(e.target.value)}
                  placeholder={
                    ai.relayConfigured ? t('settings.aiRelayServer') : 'https://example.vercel.app'
                  }
                />
              </div>
              <p className="field-hint">{t('settings.aiRelayHint')}</p>
            </>
          )}
        </div>

        {/* Outside the scrolling pane: Save used to be three screens below the
            field you had just edited. */}
        <div className="modal-foot set-foot">
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
