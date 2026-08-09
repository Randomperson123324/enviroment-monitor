'use client';

import { Laugh, Smile, Meh, Frown, Angry, Moon, RotateCw } from 'lucide-react';
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

const RING = { size: 176, radius: 78 };
const CIRC = 2 * Math.PI * RING.radius;

// ไอคอน lucide แทน emoji ใบหน้า — คีย์ด้วย band id ของคะแนน (config/sensors.js)
const SCORE_FACE = { excellent: Laugh, good: Smile, fair: Meh, poor: Frown, critical: Angry };

/** Ring/score color — band cutoffs come from SCORE_BANDS, palette from config. */
function scoreColor(score, theme) {
  return SCORE_BAND_COLORS[scoreBand(score).id]?.[theme] ?? 'var(--muted)';
}

/**
 * `summary` is the cached AI summary for the environment scope — it replaces the
 * rule-engine text that used to live on the score card. The score ring itself
 * stays rule-derived: it must update with every reading, not every 30 minutes.
 */
export default function Overview({
  latest,
  theme,
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
  const FaceIcon = score != null ? (SCORE_FACE[scoreBand(score).id] ?? Meh) : Moon;

  // AI text when it has arrived; while it is still being generated the card
  // shows the waiting/connecting copy rather than reviving the rule engine.
  const aiOk = summary?.ok !== false ? summary : null;
  const aiText = aiOk?.summary || null;
  const recos = aiOk?.recommendations?.length
    ? aiOk.recommendations
    : [{ level: 'info', text: summary?.ok === false ? summary.error : t('overview.connecting') }];

  const ts = latest?.created_at
    ? new Date(latest.created_at).toLocaleString(lang === 'en' ? 'en-GB' : 'th-TH', {
        hour12: false,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '--';

  return (
    <section className="overview">
      <div className="ring-wrap">
        <svg viewBox={`0 0 ${RING.size} ${RING.size}`}>
          <circle
            className="ring-track"
            cx={RING.size / 2}
            cy={RING.size / 2}
            r={RING.radius}
          />
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
          <FaceIcon className="ring-emoji" size={26} strokeWidth={2} color={color} aria-hidden />
          <div className="ring-num" style={{ color }}>
            {score ?? '--'}
          </div>
          <div className="ring-label">{t('overview.scoreLabel')}</div>
        </div>
      </div>

      <div className="ov-status">
        {/* In markdown style the summary is part of the rendered document below,
            so the title line would just repeat it. */}
        {summaryStyle === 'markdown' && aiText ? null : (
          <div className="ov-title">{aiText ?? t('overview.waiting')}</div>
        )}
        <div className="ov-ts">{t('overview.updated', { ts })}</div>
        <SummaryBody
          summary={summaryStyle === 'markdown' ? aiText : ''}
          recommendations={recos}
          style={summaryStyle}
        />
        {summary?.generatedAt ? (
          <div className="ov-ai-meta">
            <span className="src-tag">
              {t('aiSummary.generatedAt', { time: hhmm(summary.generatedAt, lang) })}
            </span>
            {summary.model ? <span className="src-tag">{summary.model}</span> : null}
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
        ) : null}
      </div>
    </section>
  );
}
