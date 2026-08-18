'use client';

import { Sparkles, RotateCw, TriangleAlert, Cpu, Play } from 'lucide-react';
import SummaryBody from '@/components/SummaryBody';
import { useLang } from '@/hooks/useLang';

/** "18:40" in the active locale — summaries are hours apart, so time is enough. */
function atTime(ms, lang) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * The AI summary block that sits at the top of a tab. One component for every
 * scope so the three tabs read identically; only the scope it asks for differs.
 */
export default function AiSummary({
  data,
  loading,
  error,
  onRefresh,
  title,
  style,
  /** 'server' (cached, automatic) or 'device' (this machine's GPU, on request). */
  mode = 'server',
  /** The on-device engine's own progress line — downloading, preparing, prefilling. */
  status,
  /** Set when the on-device engine has no model chosen yet. */
  needsModel = false,
  onOpenSettings,
}) {
  const { t, lang } = useLang();

  const failed = error || (data && data.ok === false);
  const message = error || data?.error || '';
  // A pinned scope must not look like it silently used something else.
  const pinned = data?.pinned?.length ? data.pinned.join(', ') : '';
  const onDevice = mode === 'device';
  /**
   * The on-device engine never runs on its own (see useOnDeviceSummary), so
   * with nothing generated yet the card's job is to offer the run rather than
   * to look like it is waiting for one.
   */
  const idle = onDevice && !loading && !data;

  return (
    <section
      className={`panel ai-summary section-gap ${loading ? 'is-analyzing' : ''}`}
      aria-busy={loading || undefined}
    >
      {/*
        Light behind the glass while the model is working — see `.ai-aura`.
        Rendered only while it runs, and only as decoration: the state is
        already announced by `aria-busy` and by the loading line below, so a
        screen reader gains nothing from the element itself.

        It also covers the case the text line cannot: a **refresh** with a
        summary already on screen, where nothing used to change at all and the
        button looked unresponsive for the several seconds a model takes.
      */}
      {loading ? <span className="ai-aura" aria-hidden /> : null}

      <div className="subhdr">
        <span className="panel-title ai-float-title">
          <Sparkles size={17} strokeWidth={2.2} aria-hidden /> {title ?? t('aiSummary.title')}
        </span>
        <span className="ai-summary-meta">
          {data?.generatedAt ? (
            <span className="src-tag">
              {t('aiSummary.generatedAt', { time: atTime(data.generatedAt, lang) })}
            </span>
          ) : null}
          {data?.model || data?.provider ? (
            <span className="src-tag">{data.model || data.provider}</span>
          ) : null}
          {/* Says where the work happens, because it changes what pressing the
              button costs: a server summary is a cached request, this one is
              this machine's GPU for as long as it takes. */}
          {onDevice ? (
            <span className="src-tag">
              <Cpu size={12} strokeWidth={2.4} aria-hidden /> {t('aiSummary.onDevice')}
            </span>
          ) : null}
          {/* Hidden while idle: the big Analyze button below is the one to
              press, and two controls for one action is one too many. */}
          {idle ? null : (
            <button
              className="icon-btn"
              onClick={onRefresh}
              disabled={loading}
              title={t(onDevice ? 'aiSummary.analyzeAgain' : 'aiSummary.refresh')}
              aria-label={t(onDevice ? 'aiSummary.analyzeAgain' : 'aiSummary.refresh')}
            >
              <RotateCw size={15} strokeWidth={2.2} aria-hidden />
            </button>
          )}
        </span>
      </div>

      {idle ? (
        <div className="ai-analyze">
          <p className="ai-analyze-text">
            {t(needsModel ? 'aiSummary.deviceNoModel' : 'aiSummary.deviceIdle')}
          </p>
          {needsModel ? (
            <button className="btn" onClick={onOpenSettings}>
              {t('aiSummary.deviceChooseModel')}
            </button>
          ) : (
            <button className="btn btn-primary btn-icon" onClick={onRefresh}>
              <Play size={15} strokeWidth={2.4} aria-hidden /> {t('aiSummary.analyze')}
            </button>
          )}
        </div>
      ) : loading && !data ? (
        /* The engine's own line when it has one — "downloading 62%" is a
           different fact from "summarizing", and on a cold model it is the
           only thing that will change for the next few minutes. */
        <div className="ai-rec info">{status || t('aiSummary.loading')}</div>
      ) : failed ? (
        /* A quiet note, not an alarm: the AI summary is commentary on the data,
           so its outage must not read louder than the sensor readings below it.
           It used to render as a full-width danger block at the top of every
           tab, which looked like the room itself was in trouble. */
        <>
          <div className="ai-note">
            <TriangleAlert size={14} strokeWidth={2.2} aria-hidden />
            <span>
              {pinned
                ? t('aiSummary.failedPinned', { providers: pinned, msg: message })
                : t('aiSummary.failed', { msg: message })}
            </span>
          </div>
          {pinned ? <div className="analyze-hint">{t('aiSummary.pinnedNote', { providers: pinned })}</div> : null}
        </>
      ) : data ? (
        <>
          <SummaryBody
            summary={data.summary}
            recommendations={data.recommendations ?? []}
            style={style}
          />
          <div className="analyze-hint">
            {loading
              ? status || t('aiSummary.loading')
              : onDevice
                ? t('aiSummary.deviceManual')
                : t('aiSummary.nextRefresh', { time: atTime(data.nextRefreshAt, lang) })}
          </div>
        </>
      ) : null}
    </section>
  );
}
