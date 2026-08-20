'use client';

import { SCORE_WEIGHT_HINT } from '@/config/client';
import { scoreWeight } from '@/lib/analysis';
import { useLang } from '@/hooks/useLang';

/** −4.2, but −4 when it is whole: a trailing ".0" reads as false precision. */
const pts = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(SCORE_WEIGHT_HINT.decimals));

/**
 * The "?" on a sensor tile: how much this reading is worth to the room score.
 *
 * The score is one number built from six sensors at different weights, and
 * nothing on screen said so — a reader watching 31 °C could not tell whether the
 * 74 in the ring was mostly about the heat or mostly about the dust. This answers
 * both halves of that: the ceiling (what this sensor can ever cost) and the live
 * figure (what it is costing now).
 *
 * A sensor the score ignores says so outright instead of showing a zero, which
 * would read as "this one is fine" rather than "this one is not counted".
 *
 * Hover **and** focus, because a control only a mouse can reach is not a control
 * everyone has. It sits inside a card that is itself a button, so both the click
 * and the key events stop here — otherwise asking what a tile weighs would open
 * its full-screen history instead.
 */
export default function ScoreWeightHint({ sensor, latest }) {
  const { t } = useLang();
  const w = scoreWeight(sensor, latest);

  const body = !w
    ? t(`sensor.${sensor.id}.weightNote`)
    : [
        t('sensor.weight.max', { max: w.max }),
        w.critical != null
          ? t('sensor.weight.ladder3', { warn: w.warn, danger: w.danger, critical: w.critical })
          : t('sensor.weight.ladder2', { warn: w.warn, danger: w.danger }),
        w.now == null
          ? t('sensor.weight.noReading')
          : w.now < SCORE_WEIGHT_HINT.zeroBelow
            ? t('sensor.weight.nowClear')
            : t('sensor.weight.now', { n: pts(w.now) }),
      ];

  return (
    <span
      className="hint"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="hint-btn"
        /* The tooltip is the label: a "?" announced as "question mark" tells a
           screen-reader user nothing, and the text below is the whole point. */
        aria-label={`${t('sensor.weight.title')} — ${Array.isArray(body) ? body.join(' ') : body}`}
      >
        ?
      </button>
      <span className="hint-pop" role="presentation">
        <strong>{t('sensor.weight.title')}</strong>
        {Array.isArray(body) ? (
          body.map((line, i) => <span key={i}>{line}</span>)
        ) : (
          <span>{body}</span>
        )}
      </span>
    </span>
  );
}
