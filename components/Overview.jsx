'use client';

import { scoreBand } from '@/config/sensors';
import { SCORE_BAND_COLORS } from '@/config/client';

const RING = { size: 176, radius: 78 };
const CIRC = 2 * Math.PI * RING.radius;

/** Ring/score color — band cutoffs come from SCORE_BANDS, palette from config. */
function scoreColor(score, theme) {
  return SCORE_BAND_COLORS[scoreBand(score).id]?.[theme] ?? 'var(--muted)';
}

export default function Overview({ latest, theme }) {
  const ai = latest?.ai_analysis ?? null;
  const score = ai?.score ?? latest?.health_score ?? null;
  const color = score != null ? scoreColor(score, theme) : 'var(--muted)';
  const offset = score != null ? CIRC * (1 - score / 100) : CIRC;

  const ts = latest?.created_at
    ? new Date(latest.created_at).toLocaleString('th-TH', {
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
          <div className="ring-emoji">{ai?.emoji ?? '💤'}</div>
          <div className="ring-num" style={{ color }}>
            {score ?? '--'}
          </div>
          <div className="ring-label">คะแนนสุขภาพห้อง</div>
        </div>
      </div>

      <div className="ov-status">
        <div className="ov-title">{ai?.msg ?? 'กำลังรอข้อมูลจากเซ็นเซอร์...'}</div>
        <div className="ov-ts">อัปเดตล่าสุด: {ts}</div>
        <div className="reco-list">
          {(ai?.recommendations ?? [{ level: 'info', text: '⏳ กำลังเชื่อมต่อ Arduino UNO Q' }]).map(
            (r, i) => (
              <div key={i} className={`reco ${r.level ?? ''}`}>
                {r.text}
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
}
