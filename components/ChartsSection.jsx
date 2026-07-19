'use client';

import { useMemo } from 'react';
import { CircleCheck, TriangleAlert, CircleAlert, Siren } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import '@/components/charts/setup';
import { SENSORS, AQI_LEVELS, aqiLevel } from '@/config/sensors';
import {
  CHART_COLORS,
  CHART_RANGES,
  SMOOTH_OPTIONS,
  CHART_VIEW_DEFAULTS,
  STATUS_COLORS,
} from '@/config/client';
import {
  buildHistView,
  smoothSeries,
  gradientFill,
  timeAxis,
  valueAxis,
  tooltipOptions,
} from '@/lib/chart-utils';

function HistoryChart({ view, smooth, colors }) {
  const gasDiv = CHART_VIEW_DEFAULTS.gasAxisDivisor;

  const data = useMemo(() => {
    const seriesColor = { temp: colors.temp, hum: colors.hum, gas: colors.gas };
    return {
      labels: view.labels,
      datasets: SENSORS.map((s) => ({
        label: s.id === 'gas' ? `ก๊าซ ÷${gasDiv}` : `${s.label} (${s.unit})`,
        data:
          s.id === 'gas'
            ? smoothSeries(view.gas, smooth).map((v) => (v != null ? v / gasDiv : null))
            : smoothSeries(view[s.id], smooth),
        borderColor: seriesColor[s.id],
        backgroundColor: gradientFill(seriesColor[s.id], 0.22),
        tension: 0.42,
        pointRadius: 0,
        borderWidth: 2,
        borderDash: s.id === 'gas' ? [5, 4] : [],
        spanGaps: true,
        fill: s.id !== 'gas',
      })),
    };
  }, [view, smooth, colors, gasDiv]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: timeAxis(colors, view.labels.length),
        y: valueAxis(colors, { scale: { suggestedMin: 0 } }),
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: colors.tick, boxWidth: 10, padding: 8, usePointStyle: true },
        },
        tooltip: { ...tooltipOptions(colors, view.timestamps), mode: 'index', intersect: false },
      },
    }),
    [colors, view]
  );

  return <Line data={data} options={options} />;
}

function ScoreChart({ view, smooth, colors }) {
  const data = useMemo(
    () => ({
      labels: view.labels,
      datasets: [
        {
          label: 'Health',
          data: smoothSeries(view.score, smooth),
          borderColor: colors.score,
          backgroundColor: gradientFill(colors.score, 0.28),
          tension: 0.42,
          pointRadius: 0,
          borderWidth: 2,
          fill: true,
          spanGaps: true,
        },
      ],
    }),
    [view, smooth, colors]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: timeAxis(colors, view.labels.length),
        y: valueAxis(colors, { scale: { min: 0, max: 100 }, ticks: { stepSize: 20 } }),
      },
      plugins: {
        legend: { display: false },
        tooltip: tooltipOptions(colors, view.timestamps),
      },
    }),
    [colors, view]
  );

  return <Line data={data} options={options} />;
}

const AQI_STATUS_ICON = {
  good: CircleCheck,
  warning: TriangleAlert,
  serious: CircleAlert,
  critical: Siren,
};

/** Linear AQI meter — status segments with icon + label (never color alone). */
function AqiMeter({ gas }) {
  const level = gas != null ? aqiLevel(gas) : null;
  const StatusIcon = level ? AQI_STATUS_ICON[level.status] : null;
  return (
    <div className="aqi-meter">
      <div className="aqi-track">
        {AQI_LEVELS.map((l) => (
          <div
            key={l.id}
            className={`aqi-seg ${level?.id === l.id ? 'on' : ''}`}
            style={{ background: STATUS_COLORS[l.status] }}
          />
        ))}
      </div>
      <div className="aqi-scale">
        {AQI_LEVELS.map((l) => (
          <span key={l.id}>{l.label}</span>
        ))}
      </div>
      <div className="aqi-reading">
        <div className="aqi-value">
          {gas != null ? Number(gas).toFixed(0) : '--'}
          <small> ppm</small>
        </div>
        <div className="aqi-cat" style={{ color: level ? STATUS_COLORS[level.status] : 'var(--muted)' }}>
          {StatusIcon ? <StatusIcon size={16} strokeWidth={2.2} aria-hidden /> : <span>—</span>}
          <span>{level?.label ?? '--'}</span>
        </div>
      </div>
    </div>
  );
}

export default function ChartsSection({ dash, theme }) {
  const colors = CHART_COLORS[theme] ?? CHART_COLORS.dark;
  const view = useMemo(() => buildHistView(dash.histRows, dash.hours), [dash.histRows, dash.hours]);

  const scores = view.score.filter((s) => s != null);
  const scoreAvg = scores.length
    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(0)
    : '--';
  const rangeLabel =
    CHART_RANGES.find((r) => r.h === dash.hours)?.label ?? `${dash.hours} ชม.`;

  return (
    <section className="charts section-gap">
      <div className="panel chart-main">
        <div className="chart-head">
          <div>
            <div className="panel-title">ข้อมูลย้อนหลัง</div>
            <div className="panel-meta">{rangeLabel}</div>
          </div>
          <div className="range-row" aria-label="ช่วงเวลา">
            {CHART_RANGES.map((r) => (
              <button
                key={r.h}
                className={`range-pill ${dash.hours === r.h ? 'active' : ''}`}
                onClick={() => dash.setHours(r.h)}
              >
                {r.label}
              </button>
            ))}
            <select
              className="chart-opt"
              value={dash.smooth}
              onChange={(e) => dash.setSmooth(Number(e.target.value))}
              title="ความลื่นของเส้นกราฟ"
              aria-label="ความลื่นของเส้นกราฟ"
            >
              {SMOOTH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="panel-meta">{view.timestamps.length} จุดข้อมูล</div>
        </div>
        <div className="chart-stage">
          {/* key remounts on theme switch — Chart.js must not animate across palettes */}
          <HistoryChart key={theme} view={view} smooth={dash.smooth} colors={colors} />
        </div>
      </div>

      <div className="chart-side">
        <div className="panel">
          <div className="chart-head">
            <div className="panel-title">คะแนนสุขภาพห้อง</div>
            <div className="panel-meta">เฉลี่ย {scoreAvg}</div>
          </div>
          <div className="chart-stage-sm">
            <ScoreChart key={theme} view={view} smooth={dash.smooth} colors={colors} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-title">คุณภาพอากาศ</div>
          <AqiMeter gas={dash.latest?.gas_ppm != null ? Number(dash.latest.gas_ppm) : null} />
        </div>
      </div>
    </section>
  );
}
