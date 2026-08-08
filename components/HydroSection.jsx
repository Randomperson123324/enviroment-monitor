'use client';

import { Droplet, TriangleAlert, Siren, CircleHelp, RotateCw } from 'lucide-react';
import useHydroFeed from '@/hooks/useHydroFeed';
import FloodPanel from '@/components/FloodPanel';
import GovPanel from '@/components/GovPanel';
import RedirectButton from '@/components/RedirectButton';
import { agoTh } from '@/lib/format';
import { useLang } from '@/hooks/useLang';

const HERO = {
  danger: { Icon: Siren, color: 'var(--lv-danger)', titleKey: 'hydro.danger' },
  warning: { Icon: TriangleAlert, color: 'var(--lv-warning)', titleKey: 'hydro.warning' },
  normal: { Icon: Droplet, color: 'var(--lv-ok)', titleKey: 'hydro.normal' },
  unknown: { Icon: CircleHelp, color: 'var(--muted)', titleKey: 'hydro.unknown' },
};

function HydroHero({ flood, gov, lastFetched, onRefresh, loading }) {
  const { t } = useLang();
  const summary = flood?.summary ?? null;
  const worst = summary?.worstFresh ?? 'unknown';
  const hero = HERO[worst] ?? HERO.unknown;
  const heroCount = worst === 'danger' ? summary.danger : worst === 'warning' ? summary.warning : 0;

  const warningCount = gov?.waterWarnings?.length ?? null;
  const topRain = gov?.rainfall?.[0] ?? null;
  const overCap = gov?.reservoirs?.overCapacityCount ?? null;

  const chips = [
    summary && { label: t('hydro.chipTotal'), value: summary.total },
    summary && summary.danger > 0 && { label: t('hydro.chipDanger'), value: summary.danger, tone: 'danger' },
    summary &&
      summary.warning > 0 && { label: t('hydro.chipWarning'), value: summary.warning, tone: 'warning' },
    summary &&
      summary.stale + summary.noData > 0 && {
        label: t('hydro.chipNoData'),
        value: summary.stale + summary.noData,
        tone: 'muted',
      },
    warningCount != null && {
      label: t('hydro.chipRainWarn'),
      value: warningCount,
      tone: warningCount ? 'warning' : undefined,
    },
    topRain && { label: t('hydro.chipRainMax'), value: `${Number(topRain.rain24h).toFixed(0)} ${t('hydro.mm')}` },
    overCap != null &&
      overCap > 0 && { label: t('hydro.chipOverCap'), value: overCap, tone: 'danger' },
  ].filter(Boolean);

  return (
    <div className="hydro-hero panel">
      <div className="hydro-hero-main">
        <div className="hydro-hero-icon" style={{ color: hero.color }}>
          <hero.Icon size={30} strokeWidth={2} aria-hidden />
        </div>
        <div className="hydro-hero-text">
          <div className="hydro-hero-title">{t(hero.titleKey, { n: heroCount })}</div>
          <div className="hydro-hero-sub">
            {t('hydro.source')}
            {lastFetched ? t('hydro.updatedAgo', { ago: agoTh(Date.now() - lastFetched) }) : ''}
          </div>
        </div>
        <button
          className="icon-btn hydro-refresh"
          onClick={onRefresh}
          title={t('hydro.refresh')}
          disabled={loading}
        >
          <RotateCw size={16} strokeWidth={2.2} className={loading ? 'spin' : undefined} aria-hidden />
        </button>
      </div>
      {chips.length > 0 && (
        <div className="hydro-chips">
          {chips.map((c, i) => (
            <div key={i} className={`hydro-chip ${c.tone ?? ''}`}>
              <span className="hydro-chip-value">{c.value}</span>
              <span className="hydro-chip-label">{c.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Hydro Info tab: hero summary + flood stations + government feeds. */
export default function HydroSection({ apiBase, serverCfg, addLog, theme }) {
  const { t } = useLang();
  const flood = useHydroFeed({
    url: `${apiBase}/api/flood`,
    refreshMs: serverCfg.floodRefreshMs,
    label: t('hydro.feedFlood'),
    addLog,
  });
  const gov = useHydroFeed({
    url: `${apiBase}/api/gov`,
    refreshMs: serverCfg.govRefreshMs,
    label: t('hydro.feedGov'),
    addLog,
  });

  const refreshAll = () => {
    flood.refresh();
    gov.refresh();
  };

  return (
    <>
      <div className="section-gap">
        <HydroHero
          flood={flood.data}
          gov={gov.data}
          lastFetched={flood.lastFetched}
          onRefresh={refreshAll}
          loading={flood.loading || gov.loading}
        />
      </div>
      <FloodPanel feed={flood} theme={theme} />
      <GovPanel feed={gov} />
      <div className="hydro-more section-gap">
        <RedirectButton href={serverCfg.streefloodUrl}>
          {t('hydro.seeMore')}
        </RedirectButton>
      </div>
    </>
  );
}
