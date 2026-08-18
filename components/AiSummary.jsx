'use client';

import { Sparkles, RotateCw, TriangleAlert } from 'lucide-react';
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
export default function AiSummary({ data, loading, error, onRefresh, title, style }) {
  const { t, lang } = useLang();

  const failed = error || (data && data.ok === false);
  const message = error || data?.error || '';
  // A pinned scope must not look like it silently used something else.
  const pinned = data?.pinned?.length ? data.pinned.join(', ') : '';

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
          <button
            className="icon-btn"
            onClick={onRefresh}
            disabled={loading}
            title={t('aiSummary.refresh')}
            aria-label={t('aiSummary.refresh')}
          >
            <RotateCw size={15} strokeWidth={2.2} aria-hidden />
          </button>
        </span>
      </div>

      {loading && !data ? (
        <div className="ai-rec info">{t('aiSummary.loading')}</div>
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
            {t('aiSummary.nextRefresh', { time: atTime(data.nextRefreshAt, lang) })}
          </div>
        </>
      ) : null}
    </section>
  );
}
