'use client';

import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import '@/components/charts/setup';
import { CHART_RANGES, CHART_COLORS, withAlpha } from '@/config/client';
import {
  smoothSeries,
  gradientFill,
  timeAxis,
  valueAxis,
  tooltipOptions,
} from '@/lib/chart-utils';
import { useLang } from '@/hooks/useLang';
import SlidingNumber from '@/components/SlidingNumber';

/**
 * Shades the sensor's ideal range straight onto the plot, so "was it ever out
 * of band, and for how long" is answered by looking rather than by reading the
 * axis against the meter below. Inline (not registered globally) because it is
 * only ever wanted here — the tiles' sparklines have no axis to hang it on.
 */
const comfortBand = {
  id: 'comfortBand',
  beforeDatasetsDraw(chart, args, opts) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales?.y || !opts?.range) return;
    const [lo, hi] = opts.range;
    const a = scales.y.getPixelForValue(lo);
    const b = scales.y.getPixelForValue(hi);
    const top = Math.max(chartArea.top, Math.min(a, b));
    const bottom = Math.min(chartArea.bottom, Math.max(a, b));
    if (bottom <= top) return;
    ctx.save();
    ctx.fillStyle = opts.color;
    ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, bottom - top);
    ctx.restore();
  },
};

/** min/avg/max over the window, ignoring gaps. */
function summarize(values) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (const v of values ?? []) {
    if (v == null) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    count++;
  }
  return count ? { min, max, avg: sum / count, count } : null;
}

/**
 * One sensor, full screen: the same reading the tile shows, with the axes,
 * range switch and window statistics the tile has no room for.
 *
 * The range pills drive the dashboard's own `hours`, not a local copy — the
 * expanded view is a bigger look at the page's current window, so closing it
 * must not silently snap the tiles back to a different range than the one just
 * being read.
 */
export default function SensorDetail({
  sensor,
  state,
  view,
  smooth,
  theme,
  hours,
  onSetHours,
  onClose,
}) {
  const { t } = useLang();
  const colors = CHART_COLORS[theme] ?? CHART_COLORS.dark;
  const color = colors[sensor.id];
  const closeRef = useRef(null);

  // Esc closes, and focus goes back to the tile that opened this — otherwise it
  // lands on <body> and the next Tab restarts from the top of the page.
  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);

  const series = view[sensor.id];
  const stats = useMemo(() => summarize(series), [series]);
  const label = t(`sensor.${sensor.id}.label`);
  const { value, judged, textKey, badgeClass } = state;

  const data = useMemo(
    () => ({
      labels: view.labels,
      datasets: [
        {
          label: t('charts.series', { label, unit: sensor.unit }),
          data: smoothSeries(series, smooth),
          borderColor: color,
          backgroundColor: gradientFill(color, 0.24),
          tension: 0.42,
          pointRadius: 0,
          borderWidth: 2,
          spanGaps: true,
          fill: true,
        },
      ],
    }),
    [view.labels, series, smooth, color, sensor.unit, label, t]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: timeAxis(colors, view.labels.length),
        y: valueAxis(colors, {
          // The tile's display range as a floor, not a cap: it frames the
          // comfort band sensibly while a reading past it still expands the
          // axis rather than being drawn off the top (lux does this daily).
          scale: { suggestedMin: sensor.bar.min, suggestedMax: sensor.bar.max },
        }),
      },
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
        comfortBand: {
          range: sensor.bar.comfort,
          color: withAlpha(colors.score, 0.1),
        },
      },
    }),
    [colors, view.labels.length, view.timestamps, sensor]
  );

  const fmt = (v) => (v != null ? v.toFixed(sensor.dp) : '--');
  // A custom window (deep link, saved setting) has no `ranges.*` string of its
  // own — same fallback the charts section uses.
  const rangeLabel = CHART_RANGES.some((r) => r.h === hours)
    ? t(`ranges.${hours}`)
    : t('charts.hoursShort', { h: hours });

  return (
    <div className="modal-ov" onClick={onClose}>
      <div
        className="modal sensor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{ '--tile-accent': color }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sensor-modal-head">
          <div className="sensor-modal-id">
            <span className="tile-label">
              <span className="tile-dot" />
              {label}
            </span>
            <span
              className={`badge ${badgeClass}`}
              title={sensor.avgHours ? t('sensor.tile.avgWindow', { h: sensor.avgHours }) : undefined}
            >
              {judged == null ? t('sensor.tile.waiting') : t(`sensor.${sensor.id}.${textKey}`)}
            </span>
          </div>
          <span className="sensor-modal-value">
            <SlidingNumber value={fmt(value)} />
            <small>{sensor.unit}</small>
          </span>
          <button
            ref={closeRef}
            className="icon-btn"
            onClick={onClose}
            aria-label={t('sensor.detail.close')}
          >
            <X size={16} strokeWidth={2.4} aria-hidden />
          </button>
        </div>

        <div className="range-row" aria-label={t('charts.timeRange')}>
          {CHART_RANGES.map((r) => (
            <button
              key={r.h}
              className={`range-pill ${hours === r.h ? 'active' : ''}`}
              onClick={() => onSetHours(r.h)}
            >
              {t(`ranges.${r.h}`)}
            </button>
          ))}
        </div>

        <div className="sensor-stage">
          {stats ? (
            /* key remounts on theme switch — Chart.js must not animate across palettes */
            <Line key={theme} data={data} options={options} plugins={[comfortBand]} />
          ) : (
            <p className="sensor-empty">{t('sensor.detail.noData')}</p>
          )}
        </div>

        <div className="sensor-stats">
          {[
            ['stats.min', stats?.min],
            ['stats.avg', stats?.avg],
            ['stats.max', stats?.max],
          ].map(([key, v]) => (
            <div className="sensor-stat" key={key}>
              <span className="sensor-stat-key">{t(key)}</span>
              <span className="sensor-stat-val">
                {fmt(v)}
                <small>{sensor.unit}</small>
              </span>
            </div>
          ))}
        </div>

        <p className="sensor-modal-foot">
          {t('sensor.detail.band', {
            lo: sensor.bar.comfort[0],
            hi: sensor.bar.comfort[1],
            unit: sensor.unit,
          })}
          {stats ? ` · ${t('charts.meta', { range: rangeLabel, n: stats.count })}` : ''}
        </p>
      </div>
    </div>
  );
}
