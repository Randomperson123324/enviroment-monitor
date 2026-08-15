'use client';

import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import '@/components/charts/setup';
import { MAIN_SENSORS, PM_SENSORS } from '@/config/sensors';
import { CHART_COLORS, AIR_ROTATE_MS } from '@/config/client';
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

/**
 * Everything a tile derives from one reading: the live value, the value the
 * *state* is judged on, and the classes that follow from it.
 *
 * A sensor may ask to be classified on a rolling mean instead of the latest
 * frame (PM: its thresholds are 24-hour standards, so one dusty minute must not
 * flip the badge). The number on screen stays the live reading either way.
 */
function tileState(sensor, latest, view) {
  const raw = latest?.[sensor.field];
  const value = raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
  const judged = sensor.avgHours
    ? trailingMean(view[sensor.id], view.timestamps, sensor.avgHours) ?? value
    : value;
  const level = judged != null ? sensor.level(judged) : null;
  const textKey = judged != null ? sensor.textKey(judged) : null;

  return {
    value,
    judged,
    level,
    textKey,
    // "okish" (past the clean mark, short of a warning) gets a neutral badge:
    // painting it the same green as "clean" told the user everything was ideal.
    badgeClass: value == null ? 'nodata' : level || (textKey === 'okish' ? 'info' : ''),
  };
}

/** The numeric readout, shared by both tile headers. */
function TileValue({ sensor, value }) {
  return (
    <span className="tile-value">
      {value != null ? value.toFixed(sensor.dp) : '--'}
      <small>{sensor.unit}</small>
    </span>
  );
}

/**
 * Sparkline + status meter + scale + badge — the part of a tile that is about
 * one measurement, with no assumption about what sits above it. The air-quality
 * card renders three of these behind one header.
 */
function TileBody({ sensor, state, view, smooth, color, colors }) {
  const { t } = useLang();
  const { value, judged, level, textKey, badgeClass } = state;

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

  // Meter geometry: value needle + healthy band, as % of the display range.
  // Two-sided metrics (temp/humidity) read correctly because "too low" and
  // "too high" both fall outside the band.
  const bar = sensor.bar;
  const span = bar.max - bar.min;
  const pct = (v) => Math.min(100, Math.max(0, ((v - bar.min) / span) * 100));
  const needlePct = value != null ? pct(value) : null;
  const comfortLeft = pct(bar.comfort[0]);
  const comfortWidth = pct(bar.comfort[1]) - comfortLeft;
  const comfort = t('sensor.tile.comfort', { lo: bar.comfort[0], hi: bar.comfort[1] });

  return (
    <>
      <div className="tile-chart">
        <Line data={data} options={options} />
      </div>
      {/*
        Three visual roles, three separate encodings:
          fill  — status (ok / warning / danger), never the sensor's own colour
          band  — the healthy range, neutral: it is scale furniture, not a state
          scale — the meter's end points
      */}
      <div
        className="tile-bar"
        role="img"
        aria-label={`${value != null ? value.toFixed(sensor.dp) : '--'} ${sensor.unit} · ${comfort}`}
        title={t('sensor.tile.barTitle')}
      >
        <div
          className="tile-bar-band"
          style={{ left: `${comfortLeft}%`, width: `${comfortWidth}%` }}
        />
        <div
          className={`tile-bar-fill ${value == null ? 'nodata' : level || 'ok'}`}
          style={{ width: `${needlePct ?? 0}%` }}
        />
      </div>
      <div className="tile-bar-scale">
        <span>
          {bar.min}
          <span className="tile-unit"> {sensor.unit}</span>
        </span>
        <span className="tile-comfort">{comfort}</span>
        <span>{bar.max}</span>
      </div>
      <div className="tile-foot">
        <span
          className={`badge ${badgeClass}`}
          title={sensor.avgHours ? t('sensor.tile.avgWindow', { h: sensor.avgHours }) : undefined}
        >
          {judged == null ? t('sensor.tile.waiting') : t(`sensor.${sensor.id}.${textKey}`)}
        </span>
      </div>
    </>
  );
}

/** One measurement, one card (temperature, humidity). */
function SensorTile({ sensor, latest, view, smooth, colors }) {
  const { t } = useLang();
  const color = colors[sensor.id];
  const state = tileState(sensor, latest, view);

  return (
    <div className="panel tile" style={{ '--tile-accent': color }}>
      <div className="tile-head">
        <span className="tile-label">
          <span className="tile-dot" />
          {t(`sensor.${sensor.id}.label`)}
        </span>
        <TileValue sensor={sensor} value={state.value} />
      </div>
      <TileBody sensor={sensor} state={state} view={view} smooth={smooth} color={color} colors={colors} />
    </div>
  );
}

/**
 * The three particulate channels as one "air quality" card that slides between
 * them on a timer.
 *
 * They were three separate tiles, which spent half the row on a distinction most
 * readers don't act on differently — PM1, PM2.5 and PM10 are one story about the
 * dust in the room. One card keeps that story in one place and leaves the row at
 * three cards: climate, humidity, air.
 *
 * Auto-advancing content can rob the reader of control, so: it pauses while the
 * pointer is over the card or focus is inside it, the dots select a channel
 * directly, and a reduced-motion preference stops the rotation altogether.
 */
function AirQualityTile({ latest, view, smooth, colors }) {
  const { t } = useLang();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % PM_SENSORS.length),
      AIR_ROTATE_MS
    );
    return () => clearInterval(timer);
  }, [paused]);

  const active = PM_SENSORS[index];
  const activeState = tileState(active, latest, view);
  const color = colors[active.id];

  return (
    <div
      className="panel tile air-tile"
      style={{ '--tile-accent': color }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="tile-head">
        <span className="tile-label">
          <span className="tile-dot" />
          {t('sensor.air.label')}
          <span className="air-chan">{t(`sensor.${active.id}.stat`)}</span>
        </span>
        <TileValue sensor={active} value={activeState.value} />
      </div>

      <div className="air-slider">
        <div className="air-track" style={{ transform: `translateX(-${index * 100}%)` }}>
          {PM_SENSORS.map((s) => (
            <div
              className="air-slide"
              key={s.id}
              /* Off-screen slides stay in the DOM (their charts must not remount
                 every rotation) but leave the reading order and tab order. */
              aria-hidden={s.id !== active.id}
              inert={s.id !== active.id ? true : undefined}
            >
              <TileBody
                sensor={s}
                state={tileState(s, latest, view)}
                view={view}
                smooth={smooth}
                color={colors[s.id]}
                colors={colors}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="air-dots" role="tablist" aria-label={t('sensor.air.label')}>
        {PM_SENSORS.map((s, i) => (
          <button
            key={s.id}
            role="tab"
            className={`air-dot ${i === index ? 'on' : ''}`}
            style={{ '--dot-color': colors[s.id] }}
            aria-selected={i === index}
            aria-label={t('sensor.air.show', { label: t(`sensor.${s.id}.label`) })}
            onClick={() => setIndex(i)}
          >
            <span>{t(`sensor.${s.id}.stat`)}</span>
          </button>
        ))}
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

// Temperature and humidity lead every climate/gas sensor list (config/sensors.js),
// so slicing the first two off MAIN_SENSORS gets them without a per-id lookup.
const [TEMP_TILE, HUM_TILE] = MAIN_SENSORS;
const SECONDARY_SENSORS = MAIN_SENSORS.slice(2);

export default function SensorTiles({ latest, histRows, hours, smooth, theme, loading }) {
  const colors = CHART_COLORS[theme] ?? CHART_COLORS.dark;
  const view = useMemo(() => buildHistView(histRows, hours), [histRows, hours]);

  if (loading) {
    return (
      <>
        <div className="tiles section-gap">
          <SkeletonTile />
          <SkeletonTile />
          <SkeletonTile />
        </div>
        <div className="tiles section-gap">
          {SECONDARY_SENSORS.map((s) => (
            <SkeletonTile key={s.id} />
          ))}
        </div>
      </>
    );
  }

  const tileProps = { latest, view, smooth, colors };

  return (
    <>
      {/* Headline row: temperature, humidity, and air quality — the three
          readings worth seeing before anything else. */}
      <div className="tiles section-gap">
        <SensorTile key={`${TEMP_TILE.id}-${theme}`} sensor={TEMP_TILE} {...tileProps} />
        <SensorTile key={`${HUM_TILE.id}-${theme}`} sensor={HUM_TILE} {...tileProps} />
        <AirQualityTile key={`air-${theme}`} {...tileProps} />
      </div>

      {/* Everything else in its own row, so it fills the width on its own
          terms instead of leaving a gap where the headline row broke off. */}
      <div className="tiles section-gap">
        {SECONDARY_SENSORS.map((s) => (
          <SensorTile key={`${s.id}-${theme}`} sensor={s} {...tileProps} />
        ))}
      </div>
    </>
  );
}
