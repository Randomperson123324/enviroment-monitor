/** Aggregate statistics over history rows (server-side, no DB round trips). */
import { SENSORS } from '@/config/sensors';

/**
 * Reading fields aggregated by the dashboard + legacy stats endpoints —
 * every sensor plus the computed score, so a new sensor needs no edit here.
 */
export const STAT_KEYS = [...SENSORS.map((s) => s.field), 'health_score'];

function summarize(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    count: nums.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: nums.reduce((a, b) => a + b, 0) / nums.length,
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
  };
}

/**
 * rows: decorated history rows. keys: reading fields to aggregate.
 * Returns { <key>: {count,min,max,avg,median} | null }.
 */
export function computeStats(rows, keys) {
  const out = {};
  for (const key of keys) {
    // null/'' means "sensor not read" and must never enter min/avg as a zero.
    out[key] = summarize(
      rows.filter((r) => r[key] != null && r[key] !== '').map((r) => Number(r[key]))
    );
  }
  return out;
}
