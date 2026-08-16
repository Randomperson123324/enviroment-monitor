'use client';

import { useMemo } from 'react';
import {
  Waves,
  Droplet,
  TriangleAlert,
  Siren,
  MoonStar,
  History,
  Thermometer,
  TrendingUp,
  TrendingDown,
  MoveRight,
} from 'lucide-react';
import { Line } from 'react-chartjs-2';
import '@/components/charts/setup';
import SectionHeader from '@/components/SectionHeader';
import SlidingNumber from '@/components/SlidingNumber';
import { CHART_COLORS, STATUS_COLORS } from '@/config/client';
import { gradientFill } from '@/lib/chart-utils';
import { agoTh, timeTh } from '@/lib/format';
import { useLang } from '@/hooks/useLang';

const SEVERITY = {
  normal: { labelKey: 'flood.sevNormal', cls: '', Icon: Droplet, color: STATUS_COLORS.good },
  warning: { labelKey: 'flood.sevWarning', cls: 'warning', Icon: TriangleAlert, color: STATUS_COLORS.warning },
  danger: { labelKey: 'flood.sevDanger', cls: 'danger', Icon: Siren, color: STATUS_COLORS.critical },
};

const TREND = {
  rising: { labelKey: 'flood.trendRising', Icon: TrendingUp },
  falling: { labelKey: 'flood.trendFalling', Icon: TrendingDown },
  stable: { labelKey: 'flood.trendStable', Icon: MoveRight },
};

function Sparkline({ history, color, colors }) {
  const { t } = useLang();
  const data = useMemo(
    () => ({
      labels: history.map(([t]) =>
        new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false })
      ),
      datasets: [
        {
          data: history.map(([, v]) => v),
          borderColor: color,
          backgroundColor: gradientFill(color, 0.3),
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2,
          fill: true,
          spanGaps: true,
        },
      ],
    }),
    [history, color]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { display: false }, y: { display: false } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          titleColor: colors.tooltipInk,
          bodyColor: colors.tooltipInk,
          borderColor: colors.border,
          borderWidth: 1,
          padding: 8,
          callbacks: {
            title: (items) => {
              const [t] = history[items[0]?.dataIndex] ?? [];
              return t ? timeTh(new Date(t).toISOString()) : '';
            },
            label: (ctx) => `${ctx.parsed.y?.toFixed(1)} ${t('flood.cm')}`,
          },
        },
      },
    }),
    [history, colors, t]
  );

  return <Line data={data} options={options} />;
}

function StationCard({ st, colors }) {
  const { t } = useLang();
  const noData = st.level == null;
  const sev = SEVERITY[st.severity] ?? SEVERITY.normal;
  const trend = TREND[st.trend] ?? TREND.stable;
  const chartColor = noData || st.stale ? colors.tick : sev.color;
  const pct = noData ? 0 : Math.min(100, Math.max(0, Math.round((st.level / st.danger_level_cm) * 100)));
  const stateCls = noData ? 'nodata' : st.stale ? 'stale' : sev.cls;

  return (
    <div className={`panel flood-card ${stateCls}`}>
      <div className="flood-card-head">
        <span className="flood-label">
          {noData ? (
            <MoonStar size={15} strokeWidth={2.2} aria-hidden />
          ) : (
            <sev.Icon size={15} strokeWidth={2.2} aria-hidden />
          )}
          {st.label}
        </span>
        <span className={`badge ${noData || st.stale ? 'nodata' : sev.cls}`}>
          {noData ? t('flood.noData') : st.stale ? t('flood.stale') : t(sev.labelKey)}
        </span>
      </div>

      <div className="flood-reading">
        <div className={`flood-level ${st.stale ? 'stale' : ''}`}>
          <SlidingNumber value={noData ? '--' : st.level.toFixed(1)} />
          <small> {t('flood.cm')}</small>
        </div>
        <div className="flood-meta">
          {!noData && (
            <span className={`flood-age ${st.stale ? 'warn' : ''}`}>
              <History size={12} strokeWidth={2.2} aria-hidden />
              {agoTh(st.readingAgeMs)}
            </span>
          )}
          {st.temperature != null && (
            <span className="flood-age">
              <Thermometer size={12} strokeWidth={2.2} aria-hidden />
              {st.temperature.toFixed(1)}°C
            </span>
          )}
        </div>
      </div>

      {st.history?.length > 1 && (
        <div className="flood-spark">
          <Sparkline history={st.history} color={chartColor} colors={colors} />
        </div>
      )}

      <div className="flood-bar">
        <div className={`flood-bar-fill ${st.stale ? 'stale' : sev.cls}`} style={{ width: `${pct}%` }} />
        <div
          className="flood-bar-mark"
          style={{ left: `${Math.min(100, (st.warning_level_cm / st.danger_level_cm) * 100)}%` }}
          title={t('flood.warnThresh', { v: st.warning_level_cm })}
        />
        <div
          className="flood-bar-mark danger"
          style={{ left: '100%' }}
          title={t('flood.dangerThresh', { v: st.danger_level_cm })}
        />
      </div>
      <div className="flood-bar-scale">
        <span>0</span>
        <span>{t('flood.warnLevel', { v: st.warning_level_cm })}</span>
        <span>{t('flood.dangerLevel', { v: st.danger_level_cm })}</span>
      </div>

      <div className="flood-sub">
        <span className="flood-trend">
          {noData ? (
            t('flood.noReading')
          ) : (
            <>
              <trend.Icon size={13} strokeWidth={2.2} aria-hidden /> {t(trend.labelKey)}
              {st.trend !== 'stable' ? ` ${t('flood.ratePerHour', { v: Math.abs(st.ratePerHour).toFixed(1) })}` : ''}
            </>
          )}
        </span>
        {!noData && <span>{t('flood.pctOfDanger', { pct })}</span>}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="panel flood-card">
      <div className="skeleton" style={{ width: '55%', height: 16 }} />
      <div className="skeleton" style={{ width: 110, height: 34, margin: '12px 0' }} />
      <div className="skeleton" style={{ width: '100%', height: 56 }} />
      <div className="skeleton" style={{ width: '100%', height: 10, marginTop: 12 }} />
    </div>
  );
}

/** Flood stations shared from StreeFlood (presentational — data via useHydroFeed). */
export default function FloodPanel({ feed, theme }) {
  const { t } = useLang();
  const colors = CHART_COLORS[theme] ?? CHART_COLORS.dark;
  const { data, error, loading } = feed;
  const stations = data?.stations ?? [];

  return (
    <section className="section-gap">
      <SectionHeader
        Icon={Waves}
        title={t('flood.title')}
        meta={
          error
            ? t('flood.metaErr')
            : data
              ? t('flood.meta', { n: stations.length })
              : ''
        }
      />

      {error && !data && (
        <div className="panel flood-empty">{t('flood.empty')}</div>
      )}

      <div className="flood-grid">
        {loading && !data && [1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        {stations.map((st) => (
          <StationCard key={`${st.sensor_id}-${theme}`} st={st} colors={colors} />
        ))}
      </div>
    </section>
  );
}
