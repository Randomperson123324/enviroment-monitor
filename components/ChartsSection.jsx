'use client';

import { useMemo } from 'react';
import { CircleCheck, TriangleAlert, CircleAlert, Siren, ChartLine } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import '@/components/charts/setup';
import SectionHeader from '@/components/SectionHeader';
import {
  SENSORS,
  CLIMATE_SENSORS,
  PM_SENSORS,
  LIGHT_SENSORS,
  GAS_SENSORS,
  VOC_SENSORS,
  PM_AVG_HOURS,
  THRESHOLDS,
  AQI_LEVELS,
  AQI_SOURCE,
  aqiLevel,
} from '@/config/sensors';
import { CHART_COLORS, CHART_RANGES, SMOOTH_OPTIONS, STATUS_COLORS } from '@/config/client';
import {
  buildHistView,
  smoothSeries,
  gradientFill,
  timeAxis,
  valueAxis,
  tooltipOptions,
  hasSeriesData,
} from '@/lib/chart-utils';
import { useLang } from '@/hooks/useLang';

/**
 * Temperature and humidity used to share one chart — °C 12–38 and % 10–95
 * happen to fit the same visual height — but they're different units on
 * different axes, so each now gets its own honest scale, same reasoning as
 * the PM/light/gas splits below.
 */
function SingleSeriesChart({ sensor, view, smooth, colors }) {
  const { t } = useLang();

  const data = useMemo(
    () => ({
      labels: view.labels,
      datasets: [
        {
          label: t('charts.series', { label: t(`sensor.${sensor.id}.label`), unit: sensor.unit }),
          data: smoothSeries(view[sensor.id], smooth),
          borderColor: colors[sensor.id],
          backgroundColor: gradientFill(colors[sensor.id], 0.22),
          tension: 0.42,
          pointRadius: 0,
          borderWidth: 2,
          spanGaps: true,
          fill: true,
        },
      ],
    }),
    [view, smooth, colors, t, sensor]
  );

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
        legend: { display: false },
        tooltip: { ...tooltipOptions(colors, view.timestamps), mode: 'index', intersect: false },
      },
    }),
    [colors, view]
  );

  return <Line data={data} options={options} />;
}

const TEMP_SENSOR = CLIMATE_SENSORS.find((s) => s.id === 'temp');
const HUM_SENSOR = CLIMATE_SENSORS.find((s) => s.id === 'hum');

function TempChart({ view, smooth, colors }) {
  return <SingleSeriesChart sensor={TEMP_SENSOR} view={view} smooth={smooth} colors={colors} />;
}

function HumChart({ view, smooth, colors }) {
  return <SingleSeriesChart sensor={HUM_SENSOR} view={view} smooth={smooth} colors={colors} />;
}

/**
 * PM gets its own chart rather than three more lines on the main one: the three
 * channels share a µg/m³ axis (no divisor trick needed) and they nest — PM10 ⊇
 * PM2.5 ⊇ PM1 — which only reads as nested when they sit on the same scale.
 * Only PM2.5 is filled; filling all three would muddy the overlap.
 */
function PmChart({ view, smooth, colors }) {
  const { t } = useLang();

  const data = useMemo(
    () => ({
      labels: view.labels,
      datasets: PM_SENSORS.map((s) => ({
        label: t('charts.series', { label: t(`sensor.${s.id}.label`), unit: s.unit }),
        data: smoothSeries(view[s.id], smooth),
        borderColor: colors[s.id],
        backgroundColor: gradientFill(colors[s.id], 0.22),
        tension: 0.42,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true,
        fill: s.id === 'pm25',
      })),
    }),
    [view, smooth, colors, t]
  );

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

/**
 * Light gets its own chart for the same reason PM does: its unit is nowhere
 * near the others'. The y-axis is capped at the glare threshold rather than
 * left to autoscale, because one sunny afternoon by the window reads tens of
 * thousands of lux and would squash every evening reading into the baseline.
 * Values above the cap still draw — they just leave the top of the frame,
 * which reads correctly as "off the scale, and that is the point".
 */
function LightChart({ view, smooth, colors }) {
  const { t } = useLang();

  const data = useMemo(
    () => ({
      labels: view.labels,
      datasets: LIGHT_SENSORS.map((s) => ({
        label: t('charts.series', { label: t(`sensor.${s.id}.label`), unit: s.unit }),
        data: smoothSeries(view[s.id], smooth),
        borderColor: colors[s.id],
        backgroundColor: gradientFill(colors[s.id], 0.22),
        tension: 0.42,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true,
        fill: true,
      })),
    }),
    [view, smooth, colors, t]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: timeAxis(colors, view.labels.length),
        y: valueAxis(colors, {
          scale: { suggestedMin: 0, suggestedMax: THRESHOLDS.lux.warnHi },
        }),
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

/**
 * CO2 and eCO2 share a chart the same way the PM channels do: both are ppm on
 * the same practical scale, so one honest axis beats a divisor trick. Only
 * CO2 is filled — eCO2 is a VOC-derived estimate riding along for reference,
 * not the primary reading (config/sensors.js).
 */
function GasChart({ view, smooth, colors }) {
  const { t } = useLang();

  const data = useMemo(
    () => ({
      labels: view.labels,
      datasets: GAS_SENSORS.map((s) => ({
        label: t('charts.series', { label: t(`sensor.${s.id}.label`), unit: s.unit }),
        data: smoothSeries(view[s.id], smooth),
        borderColor: colors[s.id],
        backgroundColor: gradientFill(colors[s.id], 0.22),
        tension: 0.42,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true,
        fill: s.id === 'co2',
      })),
    }),
    [view, smooth, colors, t]
  );

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

/**
 * TVOC gets its own chart rather than joining CO2/eCO2: it reports in ppb,
 * not ppm, and stacking a four-digit ppb series onto a low-hundreds ppm axis
 * would be the same divisor mistake the old MQ-2 chart made (see GasChart).
 */
function TvocChart({ view, smooth, colors }) {
  const { t } = useLang();
  const s = VOC_SENSORS[0];

  const data = useMemo(
    () => ({
      labels: view.labels,
      datasets: [
        {
          label: t('charts.series', { label: t(`sensor.${s.id}.label`), unit: s.unit }),
          data: smoothSeries(view[s.id], smooth),
          borderColor: colors[s.id],
          backgroundColor: gradientFill(colors[s.id], 0.22),
          tension: 0.42,
          pointRadius: 0,
          borderWidth: 2,
          spanGaps: true,
          fill: true,
        },
      ],
    }),
    [view, smooth, colors, t, s]
  );

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
        legend: { display: false },
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

/** Whichever sensor the AQI bands are defined against (config/sensors.js). */
const AQI_SENSOR = SENSORS.find((s) => s.id === AQI_SOURCE);

const AQI_STATUS_ICON = {
  good: CircleCheck,
  warning: TriangleAlert,
  serious: CircleAlert,
  critical: Siren,
};

/**
 * Air-quality meter, read from PM2.5 against the published bands.
 * Status segments carry an icon + label so the level never rests on colour.
 */
function AqiMeter({ value, unit }) {
  const { t } = useLang();
  const level = value != null ? aqiLevel(value) : null;
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
          <span key={l.id}>{t(`aqi.${l.id}`)}</span>
        ))}
      </div>
      <div className="aqi-reading">
        <div className="aqi-value">
          {value != null ? Number(value).toFixed(0) : '--'}
          <small> {unit}</small>
        </div>
        <div className="aqi-cat" style={{ color: level ? STATUS_COLORS[level.status] : 'var(--muted)' }}>
          {StatusIcon ? <StatusIcon size={16} strokeWidth={2.2} aria-hidden /> : <span>—</span>}
          <span>{level ? t(`aqi.${level.id}`) : t('sensor.tile.waiting')}</span>
        </div>
      </div>
    </div>
  );
}

export default function ChartsSection({ dash, theme }) {
  const { t } = useLang();
  const colors = CHART_COLORS[theme] ?? CHART_COLORS.dark;
  const view = useMemo(() => buildHistView(dash.histRows, dash.hours), [dash.histRows, dash.hours]);

  const scores = view.score.filter((s) => s != null);
  const scoreAvg = scores.length
    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(0)
    : '--';
  const rangeLabel = CHART_RANGES.some((r) => r.h === dash.hours)
    ? t(`ranges.${dash.hours}`)
    : t('charts.hoursShort', { h: dash.hours });

  return (
    <section className="section-gap">
      <SectionHeader
        Icon={ChartLine}
        title={t('charts.title')}
        meta={t('charts.meta', { range: rangeLabel, n: view.timestamps.length })}
      >
        <div className="range-row" aria-label={t('charts.timeRange')}>
          {CHART_RANGES.map((r) => (
            <button
              key={r.h}
              className={`range-pill ${dash.hours === r.h ? 'active' : ''}`}
              onClick={() => dash.setHours(r.h)}
            >
              {t(`ranges.${r.h}`)}
            </button>
          ))}
          <select
            className="chart-opt"
            value={dash.smooth}
            onChange={(e) => dash.setSmooth(Number(e.target.value))}
            title={t('charts.smoothing')}
            aria-label={t('charts.smoothing')}
          >
            {SMOOTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(`smooth.${o.key}`)}
              </option>
            ))}
          </select>
        </div>
      </SectionHeader>

      {/* Row 1 — the three headline reads: temperature, humidity, air quality. */}
      <div className="charts-row">
        <div className="panel">
          <div className="panel-title">{t('charts.tempTitle')}</div>
          <div className="chart-stage-md">
            {/* key remounts on theme switch — Chart.js must not animate across palettes */}
            <TempChart key={theme} view={view} smooth={dash.smooth} colors={colors} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-title">{t('charts.humTitle')}</div>
          <div className="chart-stage-md">
            <HumChart key={theme} view={view} smooth={dash.smooth} colors={colors} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-title">{t('charts.airQuality')}</div>
          <AqiMeter
            value={dash.latest?.[AQI_SENSOR.field] != null ? Number(dash.latest[AQI_SENSOR.field]) : null}
            unit={AQI_SENSOR.unit}
          />
        </div>
      </div>

      {/* Row 2 — health score plus whichever gas readings are live, filling the
          same three-up grid instead of stacking full-width one under another. */}
      <div className="charts-row section-gap">
        <div className="panel">
          <div className="chart-head">
            <div className="panel-title">{t('charts.scoreTitle')}</div>
            <div className="panel-meta">{t('charts.avg', { v: scoreAvg })}</div>
          </div>
          <div className="chart-stage-md">
            <ScoreChart key={theme} view={view} smooth={dash.smooth} colors={colors} />
          </div>
        </div>

        {hasSeriesData(view, GAS_SENSORS) && (
          <div className="panel">
            <div className="chart-head">
              <div className="panel-title">{t('charts.gasTitle')}</div>
              <div className="panel-meta">{t('charts.gasMeta')}</div>
            </div>
            <div className="chart-stage-md">
              <GasChart key={theme} view={view} smooth={dash.smooth} colors={colors} />
            </div>
          </div>
        )}

        {hasSeriesData(view, VOC_SENSORS) && (
          <div className="panel">
            <div className="chart-head">
              <div className="panel-title">{t('charts.tvocTitle')}</div>
              <div className="panel-meta">{t('charts.tvocMeta')}</div>
            </div>
            <div className="chart-stage-md">
              <TvocChart key={theme} view={view} smooth={dash.smooth} colors={colors} />
            </div>
          </div>
        )}
      </div>

      {hasSeriesData(view, PM_SENSORS) && (
        <div className="panel section-gap">
          <div className="chart-head">
            <div className="panel-title">{t('charts.pmTitle')}</div>
            <div className="panel-meta">{t('charts.pmMeta', { h: PM_AVG_HOURS })}</div>
          </div>
          <div className="chart-stage-md">
            <PmChart key={theme} view={view} smooth={dash.smooth} colors={colors} />
          </div>
        </div>
      )}

      {hasSeriesData(view, LIGHT_SENSORS) && (
        <div className="panel section-gap">
          <div className="chart-head">
            <div className="panel-title">{t('charts.lightTitle')}</div>
            <div className="panel-meta">
              {t('charts.lightMeta', { lo: THRESHOLDS.lux.okLo, hi: THRESHOLDS.lux.okHi })}
            </div>
          </div>
          <div className="chart-stage-md">
            <LightChart key={theme} view={view} smooth={dash.smooth} colors={colors} />
          </div>
        </div>
      )}
    </section>
  );
}
