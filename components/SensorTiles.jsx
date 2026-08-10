'use client';

import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import '@/components/charts/setup';
import { SENSORS } from '@/config/sensors';
import { CHART_COLORS } from '@/config/client';
import {
  buildHistView,
  smoothSeries,
  gradientFill,
  tooltipOptions,
  trailingMean,
} from '@/lib/chart-utils';
import { useLang } from '@/hooks/useLang';

// Mini sparklines read as a trend, not a data table — smooth harder than the
// main chart so raw sensor jitter doesn't look ragged (flows like the flood card).
const MINI_SMOOTH_MIN = 7;
const MINI_SMOOTH_CAP = 9;

function SensorTile({ sensor, latest, view, smooth, colors }) {
  const { t } = useLang();
  const raw = latest?.[sensor.field];
  const value = raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
  const color = colors[sensor.id];

  // The tile always shows the live number, but a sensor may ask to be *classified*
  // on a rolling mean instead (PM: its thresholds are 24-hour standards, so a
  // single dusty frame must not flip the badge). Falls back to the live value
  // when the window holds no history yet.
  const judged = sensor.avgHours
    ? trailingMean(view[sensor.id], view.timestamps, sensor.avgHours) ?? value
    : value;
  const level = judged != null ? sensor.level(judged) : null;

  const data = useMemo(
    () => ({
      labels: view.labels,
      datasets: [
        {
          data: smoothSeries(view[sensor.id], Math.min(Math.max(smooth, MINI_SMOOTH_MIN), MINI_SMOOTH_CAP)),
          borderColor: color,
          backgroundColor: gradientFill(color, 0.42),
          tension: 0.5,
          pointRadius: 0,
          borderWidth: 2,
          fill: true,
          spanGaps: true,
        },
      ],
    }),
    [view, sensor.id, smooth, color]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      // Sparkline-style: the tile already shows the live value — the mini
      // chart is a pure trend visual, axis-free like the flood cards.
      scales: { x: { display: false }, y: { display: false } },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipOptions(colors, view.timestamps),
          callbacks: {
            ...tooltipOptions(colors, view.timestamps).callbacks,
            label: (ctx) =>
              `${ctx.parsed.y != null ? ctx.parsed.y.toFixed(sensor.dp) : '--'} ${sensor.unit}`,
          },
        },
      },
    }),
    [colors, view, sensor]
  );

  // Gauge bar geometry: value needle + highlighted comfort band, as % of the
  // sensor's display range. Two-sided metrics (temp/humidity) read correctly
  // because "too low" and "too high" both fall outside the band.
  const bar = sensor.bar;
  const span = bar.max - bar.min;
  const pct = (v) => Math.min(100, Math.max(0, ((v - bar.min) / span) * 100));
  const needlePct = value != null ? pct(value) : null;
  const comfortLeft = pct(bar.comfort[0]);
  const comfortWidth = pct(bar.comfort[1]) - comfortLeft;

  return (
    <div className="panel tile" style={{ '--tile-accent': color }}>
      <div className="tile-head">
        <span className="tile-label">
          <span className="tile-dot" />
          {t(`sensor.${sensor.id}.label`)}
        </span>
        <span className="tile-value">
          {value != null ? value.toFixed(sensor.dp) : '--'}
          <small>{sensor.unit}</small>
        </span>
      </div>
      <div className="tile-chart">
        <Line data={data} options={options} />
      </div>
      <div className="tile-bar" title={t('sensor.tile.barTitle')}>
        <div
          className={`tile-bar-fill ${level || 'ok'}`}
          style={{ width: `${needlePct ?? 0}%` }}
        />
        <div
          className="tile-bar-mark"
          style={{ left: `${comfortLeft}%` }}
          title={t('sensor.tile.comfortStart', { v: bar.comfort[0], unit: sensor.unit })}
        />
        <div
          className="tile-bar-mark"
          style={{ left: `${comfortLeft + comfortWidth}%` }}
          title={t('sensor.tile.comfortEnd', { v: bar.comfort[1], unit: sensor.unit })}
        />
      </div>
      <div className="tile-bar-scale">
        <span>{bar.min}</span>
        <span>{t('sensor.tile.comfort', { lo: bar.comfort[0], hi: bar.comfort[1] })}</span>
        <span>
          {bar.max} {sensor.unit}
        </span>
      </div>
      <div className="tile-foot">
        <span
          className={`badge ${value == null ? 'nodata' : level || ''}`}
          title={sensor.avgHours ? t('sensor.tile.avgWindow', { h: sensor.avgHours }) : undefined}
        >
          {judged == null ? t('sensor.tile.waiting') : t(`sensor.${sensor.id}.${sensor.textKey(judged)}`)}
        </span>
      </div>
    </div>
  );
}

function SkeletonTile() {
  return (
    <div className="panel tile">
      <div className="tile-head">
        <div className="skeleton" style={{ width: '45%', height: 15 }} />
        <div className="skeleton" style={{ width: 60, height: 22 }} />
      </div>
      <div className="skeleton" style={{ flex: 1, minHeight: 88, margin: '10px 0 8px' }} />
      <div className="skeleton" style={{ width: '100%', height: 8, marginBottom: 10 }} />
      <div className="skeleton" style={{ width: 90, height: 22 }} />
    </div>
  );
}

export default function SensorTiles({ latest, histRows, hours, smooth, theme, loading }) {
  const colors = CHART_COLORS[theme] ?? CHART_COLORS.dark;
  const view = useMemo(() => buildHistView(histRows, hours), [histRows, hours]);

  if (loading) return SENSORS.map((s) => <SkeletonTile key={s.id} />);

  // Every sensor gets a tile, including one the device has never reported: an
  // empty PM tile reads as "waiting for the dust sensor", which is information.
  // (The PM *chart* still hides itself — three empty lines say nothing.)
  return (
    <>
      {SENSORS.map((s) => (
        <SensorTile
          key={`${s.id}-${theme}`}
          sensor={s}
          latest={latest}
          view={view}
          smooth={smooth}
          colors={colors}
        />
      ))}
    </>
  );
}
