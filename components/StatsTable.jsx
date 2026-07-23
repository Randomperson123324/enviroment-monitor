'use client';

import { Sigma } from 'lucide-react';
import SectionHeader from '@/components/SectionHeader';
import { SENSORS } from '@/config/sensors';
import { CHART_COLORS } from '@/config/client';

/** Metric rows: the three sensors plus the computed health score. */
const METRICS = [
  ...SENSORS.map((s) => ({
    id: s.id,
    label: `${s.statLabel} (${s.unit})`,
    key: s.field,
    dp: s.dp,
    color: (colors) => colors[s.id],
  })),
  { id: 'score', label: 'คะแนนสุขภาพห้อง', key: 'health_score', dp: 0, color: (colors) => colors.score },
];

const fmt = (v, dp) => (v != null && Number.isFinite(v) ? v.toFixed(dp) : '--');

/**
 * Aggregate summary as a data table — one row per metric, columns for the
 * latest reading and the window's min/avg/max. A table (not chips) because
 * the data is a 4×4 numeric grid the reader scans and compares.
 */
export default function StatsTable({ stats, latest, theme, loading }) {
  const colors = CHART_COLORS[theme] ?? CHART_COLORS.dark;
  const count = stats?.temperature?.count ?? null;

  return (
    <section className="section-gap">
      <SectionHeader
        Icon={Sigma}
        title="สรุปสถิติ"
        meta={count != null ? `จากข้อมูล ${count} จุดในช่วงที่เลือก` : ''}
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
                <th>ตัวชี้วัด</th>
                <th>ล่าสุด</th>
                <th>ต่ำสุด</th>
                <th>เฉลี่ย</th>
                <th>สูงสุด</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => {
                const block = stats?.[m.key];
                return (
                  <tr key={m.id}>
                    <td>
                      <span className="metric-cell">
                        <span className="series-dot" style={{ background: m.color(colors) }} />
                        {m.label}
                      </span>
                    </td>
                    <td className="num strong">{fmt(Number(latest?.[m.key]), m.dp)}</td>
                    <td className="num">{fmt(block?.min, m.dp)}</td>
                    <td className="num">{fmt(block?.avg, m.dp)}</td>
                    <td className="num">{fmt(block?.max, m.dp)}</td>
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
