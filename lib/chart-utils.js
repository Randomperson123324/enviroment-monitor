/**
 * Pure chart helpers shared by all chart components (client-safe, no DOM).
 * Locale: Thai timestamps, matching the rest of the UI.
 */
import { SENSORS } from '@/config/sensors';
import { withAlpha } from '@/config/client';

const LOCALE = 'th-TH';

/**
 * "Water level" area fill — vertical gradient fading to transparent, the
 * signature look of the flood-station sparklines, shared by every chart.
 */
export function gradientFill(color, alpha = 0.28) {
  return (context) => {
    const { ctx, chartArea } = context.chart;
    if (!chartArea) return withAlpha(color, alpha);
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, withAlpha(color, alpha));
    g.addColorStop(1, withAlpha(color, 0));
    return g;
  };
}

export function clampToRange(v, [lo, hi]) {
  // null/'' must stay a gap: Number(null) is 0, which would plot "can't read"
  // as a real reading of zero — indistinguishable from clean air on a PM chart.
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

/** Moving average that ignores nulls, O(n). */
export function smoothSeries(arr, window = 5) {
  if (window <= 1) return arr;
  const out = new Array(arr.length);
  const q = [];
  let sum = 0;
  let count = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    q.push(v);
    if (v != null) {
      sum += v;
      count++;
    }
    if (q.length > window) {
      const old = q.shift();
      if (old != null) {
        sum -= old;
        count--;
      }
    }
    out[i] = count ? sum / count : null;
  }
  return out;
}

/**
 * Mean of the trailing `hours` of a series, ignoring gaps (null when the window
 * holds no reading). Used where a level must not swing on a single frame —
 * see PM_AVG_HOURS in config/sensors.js.
 */
export function trailingMean(values, timestamps, hours) {
  const newest = timestamps[timestamps.length - 1];
  if (newest == null) return null;
  const cutoff = newest - hours * 3600000;
  let sum = 0;
  let count = 0;
  for (let i = timestamps.length - 1; i >= 0 && timestamps[i] >= cutoff; i--) {
    const v = values[i];
    if (v != null) {
      sum += v;
      count++;
    }
  }
  return count ? sum / count : null;
}

export function formatAxisLabel(ms, spanHours) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (spanHours <= 48) return time;
  return `${d.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit' })} ${time}`;
}

/**
 * The stamp a chart tooltip leads with — date first, then the clock.
 *
 * The date is not decoration: a chart is read hours after the window it covers,
 * and screenshotted for a report long after that. "21:08" alone is a time on an
 * unknown day, which is not a measurement anyone can check later.
 *
 * `seconds` off for series that are already bucketed (the focus chart folds
 * 15-second rows into one-minute bars) — a seconds figure there would name an
 * instant the point does not stand for.
 */
export function formatTooltipTime(ms, { seconds = true } = {}) {
  return new Date(ms).toLocaleString(LOCALE, {
    hour12: false,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });
}

/**
 * Project newest-first history rows into chronological chart arrays.
 * Values outside each sensor's physical range become gaps (null).
 */
export function buildHistView(rows, spanHours) {
  const view = { timestamps: [], labels: [], score: [] };
  for (const s of SENSORS) view[s.id] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const t = Date.parse(r.created_at);
    if (!Number.isFinite(t)) continue;
    view.timestamps.push(t);
    view.labels.push(formatAxisLabel(t, spanHours));
    for (const s of SENSORS) {
      view[s.id].push(clampToRange(r[s.field], s.range));
    }
    view.score.push(clampToRange(r.health_score, [0, 100]));
  }
  return view;
}

/**
 * Does the window hold any reading for these sensors? Surfaces that only make
 * sense for a device that actually has the hardware (the PM chart and tiles)
 * hide themselves when it answers false.
 */
export function hasSeriesData(view, sensors) {
  return sensors.some((s) => view[s.id]?.some((v) => v != null));
}

/** Shared cartesian axis options — no vertical gridlines (water-level style). */
export function timeAxis(colors, pointCount) {
  const rotate = pointCount > 14;
  return {
    grid: { display: false },
    border: { display: false },
    ticks: {
      color: colors.tick,
      maxTicksLimit: Math.min(10, Math.max(4, Math.ceil(pointCount / 6))),
      maxRotation: rotate ? 40 : 0,
      minRotation: rotate ? 25 : 0,
      autoSkip: true,
      font: { size: 9 },
    },
  };
}

export function valueAxis(colors, extra = {}) {
  return {
    grid: { color: colors.grid },
    border: { display: false },
    ticks: { color: colors.tick, font: { size: 9 }, ...extra.ticks },
    ...extra.scale,
  };
}

export function tooltipOptions(colors, timestamps) {
  return {
    backgroundColor: colors.tooltipBg,
    titleColor: colors.tooltipInk,
    bodyColor: colors.tooltipInk,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 10,
    callbacks: {
      title(items) {
        const i = items[0]?.dataIndex;
        const ts = timestamps?.[i];
        return ts ? formatTooltipTime(ts) : items[0]?.label ?? '';
      },
    },
  };
}
