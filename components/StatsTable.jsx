'use client';

import { Sigma } from 'lucide-react';
import SectionHeader from '@/components/SectionHeader';
import { SENSORS } from '@/config/sensors';
import { CHART_COLORS } from '@/config/client';
import SlidingNumber from '@/components/SlidingNumber';
import { useLang } from '@/hooks/useLang';

/** Metric rows: the three sensors plus the computed health score. */
const METRICS = [
  ...SENSORS.map((s) => ({
    id: s.id,
    statKey: `sensor.${s.id}.stat`,
    unit: s.unit,
    key: s.field,
    dp: s.dp,
    color: (colors) => colors[s.id],
  })),
  { id: 'score', statKey: 'stats.scoreLabel', unit: null, key: 'health_score', dp: 0, color: (colors) => colors.score },
];

// `Number(null)` is 0, so a column the device never reported must be rejected
// before conversion — otherwise "not read" prints as a reading of zero.
const fmt = (v, dp) =>
  v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v).toFixed(dp) : '--';

/**
 * Aggregate summary as a data table — one row per metric, columns for the
 * latest reading and the window's min/avg/max. A table (not chips) because
 * the data is a 4×4 numeric grid the reader scans and compares.
 */
export default function StatsTable({ stats, latest, theme, loading }) {
  const { t } = useLang();
  const colors = CHART_COLORS[theme] ?? CHART_COLORS.dark;
  const count = stats?.temperature?.count ?? null;

  return (
    <section className="section-gap">
      <SectionHeader
        Icon={Sigma}
        title={t('stats.title')}
        meta={count != null ? t('stats.meta', { n: count }) : ''}
      />
      <div className="panel table-wrap">
        {loading ? (
          <div className="table-skeleton">
            {METRICS.map((m) => (
              <div key={m.id} className="skeleton" style={{ height: 16 }} />
            ))}
          </div>
        ) : (
          <table className="stats-table">
            <thead>
              <tr>
                <th>{t('stats.metric')}</th>
                <th>{t('stats.latest')}</th>
                <th>{t('stats.min')}</th>
                <th>{t('stats.avg')}</th>
                <th>{t('stats.max')}</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => {
                const block = stats?.[m.key];
                const label = m.unit ? `${t(m.statKey)} (${m.unit})` : t(m.statKey);
                return (
                  <tr key={m.id}>
                    <td>
                      <span className="metric-cell">
                        <span className="series-dot" style={{ background: m.color(colors) }} />
                        {label}
                      </span>
                    </td>
                    <td className="num strong">
                      <SlidingNumber value={fmt(latest?.[m.key], m.dp)} />
                    </td>
                    <td className="num">
                      <SlidingNumber value={fmt(block?.min, m.dp)} />
                    </td>
                    <td className="num">
                      <SlidingNumber value={fmt(block?.avg, m.dp)} />
                    </td>
                    <td className="num">
                      <SlidingNumber value={fmt(block?.max, m.dp)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
