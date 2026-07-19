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

export function formatAxisLabel(ms, spanHours) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (spanHours <= 48) return time;
  return `${d.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit' })} ${time}`;
}

export function formatTooltipTime(ms) {
  return new Date(ms).toLocaleString(LOCALE, {
    hour12: false,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Project newest-first history rows into chronological chart arrays.
 * Values outside each sensor's physical range become gaps (null).
 */
export function buildHistView(rows, spanHours) {
  const view = { timestamps: [], labels: [], temp: [], hum: [], gas: [], score: [] };
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
