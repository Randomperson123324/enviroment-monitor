/**
 * Flood-warning data bridge — reads the StreeFlood project's `sensors` and
 * `water_readings` tables (shared database or the original StreeFlood
 * Supabase, per config). Severity/trend math mirrors StreeFlood's
 * lib/water-analysis.ts so both apps always agree on status.
 */
import config from '@/config';

function floodHeaders() {
  const { anonKey } = config.flood;
  return { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
}

async function floodSelect(table, params) {
  const q = new URLSearchParams({ select: '*', ...params });
  const res = await fetch(`${config.flood.url}/rest/v1/${table}?${q}`, {
    headers: floodHeaders(),
    signal: AbortSignal.timeout(config.flood.timeoutMs),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Flood DB ${res.status}`);
  return res.json();
}

export function floodConfigured() {
  return Boolean(config.flood.url && config.flood.anonKey);
}

/** Linear regression of level over time → slope in cm/hour (StreeFlood port). */
function computeRatePerHour(readings) {
  if (readings.length < 2) return 0;
  const points = readings.map((r) => ({ t: Date.parse(r.timestamp), y: Number(r.level) }));
  const n = points.length;
  const meanT = points.reduce((s, p) => s + p.t, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - meanT) * (p.y - meanY);
    den += (p.t - meanT) ** 2;
  }
  return den === 0 ? 0 : (num / den) * 3_600_000;
}

function computeTrend(ratePerHour) {
  const s = config.flood.stableRateCmPerHour;
  if (ratePerHour > s) return 'rising';
  if (ratePerHour < -s) return 'falling';
  return 'stable';
}

function computeSeverity(level, warningLevel, dangerLevel) {
  if (level >= dangerLevel) return 'danger';
  if (level >= warningLevel) return 'warning';
  return 'normal';
}

/** Snapshot of every active flood sensor with its latest level + trend. */
export async function getFloodStatus() {
  const { sensorsTable, readingsTable, trendReadings, trendWindowHours, staleAfterHours } =
    config.flood;

  // Older StreeFlood databases predate the `is_default` column — fall back
  // to a plain label sort when the preferred order is rejected.
  const sensors = await floodSelect(sensorsTable, {
    is_active: 'eq.true',
    order: 'is_default.desc,label.asc',
  }).catch(() =>
    floodSelect(sensorsTable, { is_active: 'eq.true', order: 'label.asc' })
  );

  const stations = await Promise.all(
    sensors.map(async (s) => {
      const readings = await floodSelect(readingsTable, {
        sensor_id: `eq.${s.sensor_id}`,
        order: 'timestamp.desc',
        limit: String(trendReadings),
      }).catch(() => []);

      const latest = readings[0] ?? null;
      const windowStart = Date.now() - trendWindowHours * 3_600_000;
      const trendWindow = readings.filter((r) => Date.parse(r.timestamp) >= windowStart).reverse();
      const ratePerHour = computeRatePerHour(trendWindow);
      const level = latest ? Number(latest.level) : null;
      const readingAgeMs = latest ? Date.now() - Date.parse(latest.timestamp) : null;
      const stale = readingAgeMs != null && readingAgeMs > staleAfterHours * 3_600_000;

      return {
        sensor_id: s.sensor_id,
        label: s.label,
        warning_level_cm: Number(s.warning_level_cm),
        danger_level_cm: Number(s.danger_level_cm),
        level,
        temperature: latest?.temperature != null ? Number(latest.temperature) : null,
        timestamp: latest?.timestamp ?? null,
        readingAgeMs,
        stale,
        severity:
          level != null
            ? computeSeverity(level, Number(s.warning_level_cm), Number(s.danger_level_cm))
            : null,
        ratePerHour: Math.round(ratePerHour * 100) / 100,
        trend: computeTrend(ratePerHour),
        /** Chronological [timestamp, level] pairs for the station sparkline. */
        history: [...readings]
          .reverse()
          .map((r) => [Date.parse(r.timestamp), Number(r.level)]),
      };
    })
  );

  // Live summary — stale stations report history, not the current situation.
  const fresh = stations.filter((s) => !s.stale && s.level != null);
  const count = (sev) => fresh.filter((s) => s.severity === sev).length;
  const summary = {
    total: stations.length,
    danger: count('danger'),
    warning: count('warning'),
    normal: count('normal'),
    stale: stations.filter((s) => s.stale).length,
    noData: stations.filter((s) => s.level == null).length,
    worstFresh: count('danger') ? 'danger' : count('warning') ? 'warning' : fresh.length ? 'normal' : null,
  };

  return {
    stations,
    summary,
    source: config.flood.url,
    updatedAt: new Date().toISOString(),
  };
}
