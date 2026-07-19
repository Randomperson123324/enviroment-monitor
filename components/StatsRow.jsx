'use client';

import { SENSORS } from '@/config/sensors';

const METRICS = [
  ...SENSORS.map((s) => ({ id: s.id, label: `${s.statLabel} (${s.unit})`, key: s.field, dp: s.dp })),
  { id: 'score', label: 'คะแนนสุขภาพห้อง', key: 'health_score', dp: 0 },
];

const fmt = (v, dp) => (v != null && Number.isFinite(v) ? v.toFixed(dp) : '--');

export default function StatsRow({ stats, loading }) {
  if (loading) {
    return (
      <section className="stats-row section-gap">
        {METRICS.map((m) => (
          <div key={m.id} className="panel stat-chip">
            <div className="skeleton" style={{ width: '55%', height: 14 }} />
            <div className="skeleton" style={{ width: '80%', height: 18, marginTop: 10 }} />
          </div>
        ))}
      </section>
    );
  }

  return (
    <section className="stats-row section-gap">
      {METRICS.map((m) => {
        const block = stats?.[m.key];
        return (
          <div key={m.id} className="panel stat-chip">
            <div className="stat-label">{m.label}</div>
            <div className="stat-vals">
              <div>
                <b>เฉลี่ย</b>
                {fmt(block?.median ?? block?.avg, m.dp)}
              </div>
              <div>
                <b>ต่ำสุด</b>
                {fmt(block?.min, m.dp)}
              </div>
              <div>
                <b>สูงสุด</b>
                {fmt(block?.max, m.dp)}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
