'use client';

import { SENSORS } from '@/config/sensors';
import { STATUS_COLORS } from '@/config/client';

const RING = { size: 176, radius: 78 };
const CIRC = 2 * Math.PI * RING.radius;

/** Ring/score color by band — status palette, plus the score green when excellent. */
function scoreColor(score, theme) {
  if (score >= 85) return theme === 'dark' ? '#1baf7a' : '#157a57';
  if (score >= 70) return STATUS_COLORS.good;
  if (score >= 50) return theme === 'dark' ? STATUS_COLORS.warning : '#8a5a00';
  if (score >= 30) return STATUS_COLORS.serious;
  return STATUS_COLORS.critical;
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

  const issueBySensor = Object.fromEntries((ai?.issues ?? []).map((i) => [i.sensor, i]));

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

      <div className="ov-badges">
        {SENSORS.map((s) => {
          const issue = issueBySensor[s.id];
          return (
            <div key={s.id} className={`ov-badge ${issue?.level ?? ''}`}>
              <span className="dot" />
              <span>
                {s.label} · {issue?.level ? issue.msg : 'ปกติ'}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
