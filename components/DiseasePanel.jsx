'use client';

import { useMemo } from 'react';
import { Activity, ShieldCheck, ExternalLink, ShieldAlert, TriangleAlert } from 'lucide-react';
import { assessDiseases } from '@/lib/disease';

const WORST = {
  danger: { Icon: ShieldAlert, color: 'var(--lv-danger)', title: 'มีความเสี่ยงต่อโรคสูง — ควรรีบปรับสภาพแวดล้อม' },
  warning: { Icon: TriangleAlert, color: 'var(--lv-warning)', title: 'มีความเสี่ยงต่อโรคบางชนิด — ควรเฝ้าระวัง' },
  clear: { Icon: ShieldCheck, color: 'var(--lv-ok)', title: 'ความเสี่ยงต่อโรคจากสิ่งแวดล้อมต่ำ' },
};

/**
 * Environmental disease-risk assessment — which illnesses spread more readily
 * under current temp/humidity/air-quality, with a cited source per risk.
 * Rule-based (config/diseases.js), computed live from the latest reading.
 */
export default function DiseasePanel({ latest }) {
  const { risks, worst, allClear } = useMemo(() => assessDiseases(latest), [latest]);
  const head = WORST[worst ?? 'clear'];
  const loading = !latest;

  return (
    <section className="section-gap">
      <div className="focus-hdr">
        <div className="focus-title">
          <span className="section-title">
            <Activity size={19} strokeWidth={2.2} aria-hidden /> ความเสี่ยงโรคจากสภาพแวดล้อม
          </span>
        </div>
        <span className="panel-meta">วิเคราะห์จากอุณหภูมิ · ความชื้น · คุณภาพอากาศ</span>
      </div>

      <div className="panel disease-hero">
        <div className="disease-hero-icon" style={{ color: head.color }}>
          <head.Icon size={26} strokeWidth={2} aria-hidden />
        </div>
        <div>
          <div className="disease-hero-title">
            {loading ? 'กำลังรอข้อมูลเซ็นเซอร์...' : head.title}
          </div>
          <div className="disease-hero-sub">
            {loading
              ? 'ต้องมีข้อมูลอุณหภูมิ ความชื้น หรือก๊าซ เพื่อประเมินความเสี่ยง'
              : risks.length
                ? `พบความเสี่ยง ${risks.length} รายการ`
                : allClear?.detail}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="disease-grid">
          {[1, 2, 3].map((i) => (
            <div key={i} className="panel disease-card">
              <div className="skeleton" style={{ width: '60%', height: 15 }} />
              <div className="skeleton" style={{ width: '100%', height: 13, marginTop: 12 }} />
              <div className="skeleton" style={{ width: '85%', height: 13, marginTop: 8 }} />
            </div>
          ))}
        </div>
      ) : risks.length ? (
        <div className="disease-grid">
          {risks.map((d) => (
            <div key={d.id} className={`panel disease-card ${d.level}`}>
              <div className="disease-card-head">
                <span className="disease-name">
                  <span className="disease-emoji">{d.icon}</span> {d.name}
                </span>
                <span className={`badge ${d.level}`}>
                  {d.level === 'danger' ? 'เสี่ยงสูง' : 'เฝ้าระวัง'}
                </span>
              </div>
              <p className="disease-reason">{d.reason}</p>
              <p className="disease-prevention">
                <ShieldCheck size={13} strokeWidth={2.2} aria-hidden /> {d.prevention}
              </p>
              <a
                className="disease-source"
                href={d.source.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={12} strokeWidth={2.2} aria-hidden /> ที่มา: {d.source.name}
              </a>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
