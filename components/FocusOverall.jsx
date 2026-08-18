'use client';

import { SCORE_BAND_COLORS } from '@/config/client';
import SlidingNumber from '@/components/SlidingNumber';

// Matches the room-score ring in Overview.jsx — the two numbers sit one tab
// apart and must read as the same instrument, not two dials of different sizes.
const RING = { size: 112, radius: 48 };
const CIRC = 2 * Math.PI * RING.radius;

/** Which signals get a chip, and the i18n key naming each one. */
const PART_LABELS = {
  engagement: 'focus.partEngagement',
  phone: 'focus.partPhone',
  posture: 'focus.partPosture',
};

/**
 * The session's overall focus score: one ring for the whole window, built by
 * `overallFocusScore` and banded on the same cutoffs as the room score.
 *
 * The breakdown underneath is the point of the card. A bare 48 says a lesson
 * went badly without saying what to change, and the three signals do not carry
 * equal weight — "phone −21, movement −9" tells the teacher to look up from
 * the desk, which the ring alone never could. Signals nothing measured are
 * absent rather than shown as zero, so an unchecked column can't read as a
 * clean one.
 */
export default function FocusOverall({ overall, theme, t }) {
  const score = overall?.score ?? null;
  const band = overall?.band ?? null;
  const color = band ? SCORE_BAND_COLORS[band.id]?.[theme] ?? 'var(--muted)' : 'var(--muted)';
  const offset = score != null ? CIRC * (1 - score / 100) : CIRC;

  return (
    <section className={`overview focus-overall ${overall?.low ? 'is-low' : ''}`}>
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
            <SlidingNumber value={String(score ?? '--')} />
          </div>
        </div>
      </div>

      <div className="ov-status">
        <div className="ov-head">
          <span className="ov-score-label">{t('focus.overallLabel')}</span>
          {overall ? (
            <span className="ov-ts">
              {t('focus.overallWindow', { mins: overall.minutes, people: overall.people })}
            </span>
          ) : null}
        </div>

        <div className="ov-title">
          {band ? t(`focus.band.${band.id}`) : t('focus.overallWaiting')}
        </div>

        {overall ? (
          <div className="focus-parts">
            {overall.parts.map((p) => (
              <span
                key={p.id}
                className={`focus-part ${p.penalty > 0 ? 'costly' : ''}`}
                title={t(`${PART_LABELS[p.id]}Hint`)}
              >
                <span className="focus-part-name">{t(PART_LABELS[p.id])}</span>
                {/* A signal that cost nothing is worth showing too: it is the
                    difference between "phones were fine" and "phones were never
                    checked", and only the first one belongs in the list. */}
                <span className="focus-part-val">
                  {p.penalty > 0 ? t('focus.partPenalty', { n: p.penalty }) : t('focus.partClear')}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <div className="fcard-sub">{t('focus.overallWaitingHint')}</div>
        )}
      </div>
    </section>
  );
}
