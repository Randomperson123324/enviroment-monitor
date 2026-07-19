/** Aggregate statistics over history rows (server-side, no DB round trips). */

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
    out[key] = summarize(rows.map((r) => Number(r[key])));
  }
  return out;
}
