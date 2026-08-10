'use client';

import { RotateCw, TriangleAlert } from 'lucide-react';
import { scoreBand } from '@/config/sensors';
import { SCORE_BAND_COLORS } from '@/config/client';
import SummaryBody from '@/components/SummaryBody';
import { useLang } from '@/hooks/useLang';

/** "18:40" in the active locale — summaries are hours apart, so time is enough. */
const hhmm = (ms, lang) =>
  new Date(ms).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

// Compact ring: this card is the page header, not the page. It used to stand
// 200px tall on a 176px ring and pushed the actual sensor tiles below the fold.
const RING = { size: 112, radius: 48 };
const CIRC = 2 * Math.PI * RING.radius;

/** Ring/score color — band cutoffs come from SCORE_BANDS, palette from config. */
function scoreColor(score, theme) {
  return SCORE_BAND_COLORS[scoreBand(score).id]?.[theme] ?? 'var(--muted)';
}

/**
 * Room score + the current AI read on it.
 *
 * `summary` is the cached AI summary for the environment scope; the ring stays
 * rule-derived because it must move with every reading, not every 30 minutes.
 * When the AI summary has not arrived (or failed) the card falls back to the
 * rule engine's own recommendations rather than a "connecting…" placeholder —
 * they are computed from the same reading and are always available.
 */
export default function Overview({
  latest,
  theme,
  status,
  summary,
  summaryStyle,
  summaryLoading,
  onRefreshSummary,
}) {
  const { t, lang } = useLang();
  const ai = latest?.ai_analysis ?? null;
  const score = ai?.score ?? latest?.health_score ?? null;
  const color = score != null ? scoreColor(score, theme) : 'var(--muted)';
  const offset = score != null ? CIRC * (1 - score / 100) : CIRC;

  const aiOk = summary?.ok !== false ? summary : null;
  const aiText = aiOk?.summary || null;
  const recos = aiOk?.recommendations?.length ? aiOk.recommendations : (ai?.recommendations ?? []);
  const aiFailed = summary?.ok === false;
  const stale = status && status.level !== 'live';

  return (
    <section className={`overview ${stale ? 'is-stale' : ''}`}>
      <div className="ring-wrap">
        <svg viewBox={`0 0 ${RING.size} ${RING.size}`}>
          <circle className="ring-track" cx={RING.size / 2} cy={RING.size / 2} r={RING.radius} />
          <circle
            className="ring-fill"
            cx={RING.size / 2}
            cy={RING.size / 2}
            r={RING.radius}
            stroke={color}
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="ring-inner">
          <div className="ring-num" style={{ color }}>
            {score ?? '--'}
          </div>
        </div>
      </div>

      <div className="ov-status">
        <div className="ov-head">
          <span className="ov-score-label">{t('overview.scoreLabel')}</span>
          {status?.atLabel ? (
            <span className="ov-ts">{t('status.at', { ts: status.atLabel })}</span>
          ) : null}
          {stale ? <span className="badge nodata">{t('status.staleTag')}</span> : null}
        </div>

        {/* In markdown style the summary is part of the rendered document below,
            so a title line here would just repeat it. */}
        {summaryStyle === 'markdown' && aiText ? null : (
          <div className="ov-title">{aiText ?? t('overview.waiting')}</div>
        )}

        <SummaryBody
          summary={summaryStyle === 'markdown' ? aiText : ''}
          recommendations={recos}
          style={summaryStyle}
        />

        <div className="ov-ai-meta">
          {aiFailed ? (
            <span className="src-tag warn" title={summary.error}>
              <TriangleAlert size={12} strokeWidth={2.4} aria-hidden />
              {t('aiSummary.failed', { msg: summary.error })}
            </span>
          ) : summary?.generatedAt ? (
            <span className="src-tag">
              {t('aiSummary.generatedAt', { time: hhmm(summary.generatedAt, lang) })}
            </span>
          ) : null}
          {summary?.model ? <span className="src-tag">{summary.model}</span> : null}
          <button
            className="icon-btn"
            onClick={onRefreshSummary}
            disabled={summaryLoading}
            title={t('aiSummary.refresh')}
            aria-label={t('aiSummary.refresh')}
          >
            <RotateCw size={14} strokeWidth={2.2} aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}
