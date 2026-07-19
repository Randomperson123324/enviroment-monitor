'use client';

import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import '@/components/charts/setup';
import { SENSORS } from '@/config/sensors';
import { CHART_COLORS } from '@/config/client';
import { buildHistView, smoothSeries, gradientFill, tooltipOptions } from '@/lib/chart-utils';

const MINI_SMOOTH_CAP = 7;

function SensorTile({ sensor, latest, view, smooth, colors }) {
  const raw = latest?.[sensor.field];
  const value = raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
  const level = value != null ? sensor.level(value) : null;
  const color = colors[sensor.id === 'temp' ? 'temp' : sensor.id === 'hum' ? 'hum' : 'gas'];

  const data = useMemo(
    () => ({
      labels: view.labels,
      datasets: [
        {
          data: smoothSeries(view[sensor.id], Math.min(smooth, MINI_SMOOTH_CAP)),
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
          {sensor.label}
        </span>
        <span className="tile-value">
          {value != null ? value.toFixed(sensor.dp) : '--'}
          <small>{sensor.unit}</small>
        </span>
      </div>
      <div className="tile-chart">
        <Line data={data} options={options} />
      </div>
      <div className="tile-gauge" title="แถบแสดงช่วงค่าที่เหมาะสม">
        <div
          className="tile-gauge-band"
          style={{ left: `${comfortLeft}%`, width: `${comfortWidth}%`, background: color }}
        />
        {needlePct != null && (
          <div
            className={`tile-gauge-needle ${level || 'ok'}`}
            style={{ left: `${needlePct}%` }}
          />
        )}
      </div>
      <div className="tile-foot">
        <span className={`badge ${value == null ? 'nodata' : level || ''}`}>
          {value == null ? 'รอข้อมูล' : sensor.text(value)}
        </span>
        <span className="tile-range">
          {bar.min}–{bar.max} {sensor.unit}
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
