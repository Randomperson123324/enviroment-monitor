'use client';

import { Eye, ScanFace, Sparkles } from 'lucide-react';
import { WEBCAM } from '@/config/sensors';

/** Eye state derived from webcam_json (face + EAR + blinking flags). */
function eyeState(w) {
  if (!w.face_detected) return { label: 'ไม่พบใบหน้า', color: 'var(--muted)' };
  if (w.is_blinking) return { label: 'หลับตา', color: 'var(--lv-danger)' };
  const ear = ((w.ear_left ?? 0) + (w.ear_right ?? 0)) / 2;
  if (ear > 0 && ear < WEBCAM.drowsyEarBelow) return { label: 'ง่วง', color: 'var(--lv-warning)' };
  return { label: 'ลืมตา', color: 'var(--lv-ok)' };
}

/** Webcam analytics strip — rendered only when the reading carries webcam_json. */
export default function WebcamStrip({ webcam }) {
  if (!webcam || typeof webcam !== 'object') return null;
  const eye = eyeState(webcam);
  const blink = Number(webcam.blink_rate ?? 0);
  const [lo, hi] = WEBCAM.blinkNormal;
  const blinkNote = blink === 0 ? '--' : blink < lo ? 'ต่ำกว่าปกติ' : blink > hi ? 'สูงกว่าปกติ' : 'ปกติ';

  return (
    <section className="webcam-strip section-gap">
      <div className="panel webcam-card">
        <div className="webcam-icon">
          <Eye size={21} strokeWidth={2} aria-hidden />
        </div>
        <div>
          <div className="webcam-label">คะแนนโฟกัส</div>
          <div className="webcam-val">
            {Number(webcam.focus_score ?? 0).toFixed(0)}
            <small style={{ fontSize: 12, color: 'var(--muted)' }}>%</small>
          </div>
          <div className="webcam-sub">วิเคราะห์จากกล้อง ({webcam.backend ?? '—'})</div>
        </div>
      </div>
      <div className="panel webcam-card">
        <div className="webcam-icon">
          <ScanFace size={21} strokeWidth={2} aria-hidden />
        </div>
        <div>
          <div className="webcam-label">สถานะดวงตา</div>
          <div className="webcam-val" style={{ color: eye.color, fontSize: 17 }}>
            {eye.label}
          </div>
          <div className="webcam-sub">{webcam.assessment ?? '--'}</div>
        </div>
      </div>
      <div className="panel webcam-card">
        <div className="webcam-icon">
          <Sparkles size={21} strokeWidth={2} aria-hidden />
        </div>
        <div>
          <div className="webcam-label">อัตรากะพริบตา</div>
          <div className="webcam-val">
            {blink.toFixed(0)}
            <small style={{ fontSize: 12, color: 'var(--muted)' }}>/min</small>
          </div>
          <div className="webcam-sub">{blinkNote}</div>
        </div>
      </div>
    </section>
  );
}
