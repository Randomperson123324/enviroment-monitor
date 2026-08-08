'use client';

import { useMemo } from 'react';
import {
  Activity,
  ShieldCheck,
  ExternalLink,
  ShieldAlert,
  TriangleAlert,
  Droplets,
  Snowflake,
  Bug,
  ThermometerSun,
  Wind,
  Utensils,
} from 'lucide-react';
import SectionHeader from '@/components/SectionHeader';
import { assessDiseases } from '@/lib/disease';
import { useLang } from '@/hooks/useLang';

const WORST = {
  danger: { Icon: ShieldAlert, color: 'var(--lv-danger)', titleKey: 'disease.heroDanger' },
  warning: { Icon: TriangleAlert, color: 'var(--lv-warning)', titleKey: 'disease.heroWarning' },
  clear: { Icon: ShieldCheck, color: 'var(--lv-ok)', titleKey: 'disease.heroClear' },
};

// ไอคอน lucide แทน emoji เดิม — คีย์ด้วย id ของโรคใน config/diseases.js
const DISEASE_ICONS = {
  mould: Droplets,
  flu: Snowflake,
  dustmite: Bug,
  heat: ThermometerSun,
  respiratory: Wind,
  bacteria: Utensils,
};

/**
 * Environmental disease-risk assessment — which illnesses spread more readily
 * under current temp/humidity/air-quality, with a cited source per risk.
 * Rule-based (config/diseases.js), computed live from the latest reading.
 */
export default function DiseasePanel({ latest }) {
  const { t } = useLang();
  const { risks, worst } = useMemo(() => assessDiseases(latest), [latest]);
  const head = WORST[worst ?? 'clear'];
  const loading = !latest;

  return (
    <section className="section-gap">
      <SectionHeader
        Icon={Activity}
        title={t('disease.section')}
        meta={t('disease.meta')}
      />

      <div className="panel disease-hero">
        <div className="disease-hero-icon" style={{ color: head.color }}>
          <head.Icon size={26} strokeWidth={2} aria-hidden />
        </div>
        <div>
          <div className="disease-hero-title">
            {loading ? t('disease.waiting') : t(head.titleKey)}
          </div>
          <div className="disease-hero-sub">
            {loading
              ? t('disease.needData')
              : risks.length
                ? t('disease.found', { n: risks.length })
                : t('disease.clearDetail')}
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
          {risks.map((d) => {
            const Icon = DISEASE_ICONS[d.id] ?? Activity;
            return (
            <div key={d.id} className={`panel disease-card ${d.level}`}>
              <div className="disease-card-head">
                <span className="disease-name">
                  <Icon
                    className="disease-icon"
                    size={17}
                    strokeWidth={2.1}
                    style={{ color: d.level === 'danger' ? 'var(--lv-danger)' : 'var(--lv-warning)' }}
                    aria-hidden
                  />{' '}
                  {t(d.nameKey)}
                </span>
                <span className={`badge ${d.level}`}>
                  {d.level === 'danger' ? t('disease.levelDanger') : t('disease.levelWarning')}
                </span>
              </div>
              <p className="disease-reason">{t(d.reasonKey, d.reasonVars)}</p>
              <p className="disease-prevention">
                <ShieldCheck size={13} strokeWidth={2.2} aria-hidden /> {t(d.preventionKey)}
              </p>
              <a
                className="disease-source"
                href={d.source.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={12} strokeWidth={2.2} aria-hidden /> {t('disease.source', { name: d.source.name })}
              </a>
            </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
