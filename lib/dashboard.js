/**
 * Data-assembly layer shared by the dashboard, legacy, and AI routes.
 * All rows leave this module already decorated with health_score.
 */
import config from '@/config';
import { selectRows } from '@/lib/supabase';
import { decorateRow } from '@/lib/analysis';
import { computeStats, STAT_KEYS } from '@/lib/stats';

const INVALID_DEVICE_IDS = new Set(['', 'unknown', 'null', 'none', 'undefined', 'auto', '*']);

export function normalizeDeviceId(id) {
  const v = String(id ?? '').trim();
  return INVALID_DEVICE_IDS.has(v.toLowerCase()) ? null : v;
}

export function clampHours(hours) {
  if (hours == null || hours === '') return config.api.defaultHours;
  const h = Number(hours);
  if (!Number.isFinite(h)) return config.api.defaultHours;
  return Math.min(config.api.maxHours, Math.max(1, h));
}

export function clampLimit(limit) {
  if (limit == null || limit === '') return config.api.defaultHistoryLimit;
  const n = Number(limit);
  if (!Number.isFinite(n)) return config.api.defaultHistoryLimit;
  return Math.min(config.api.maxHistoryLimit, Math.max(1, Math.round(n)));
}

function sinceIso(hours) {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

function dedupeDeviceIds(rows) {
  const seen = [];
  for (const r of rows) {
    const id = normalizeDeviceId(r.device_id);
    if (id && !seen.includes(id)) seen.push(id);
  }
  return seen;
}

/**
 * Distinct device ids seen within the lookback window, newest first.
 * Falls back to an unwindowed scan so the dashboard still resolves a device
 * when every sensor has been offline longer than the window.
 */
export async function listDevices(hours = config.api.deviceLookbackHours) {
  const windowed = await selectRows(config.supabase.envTable, {
    select: 'device_id',
    'created_at': `gte.${sinceIso(clampHours(hours))}`,
    order: 'created_at.desc',
    limit: String(config.api.deviceScanLimit),
  });
  const devices = dedupeDeviceIds(windowed);
  if (devices.length) return devices;

  const anytime = await selectRows(config.supabase.envTable, {
    select: 'device_id',
    order: 'created_at.desc',
    limit: String(config.api.deviceScanLimit),
  });
  return dedupeDeviceIds(anytime);
}

/** Newest reading for a device (or any device when id is null). */
export async function getLatest(deviceId) {
  const params = {
    order: 'created_at.desc',
    limit: '1',
  };
  if (deviceId) params.device_id = `eq.${deviceId}`;
  const rows = await selectRows(config.supabase.envTable, params);
  return rows[0] ?? null;
}

/** History rows, newest first, within the window. */
export async function getHistory({ deviceId, hours, limit }) {
  const params = {
    'created_at': `gte.${sinceIso(hours)}`,
    order: 'created_at.desc',
    limit: String(limit),
  };
  if (deviceId) params.device_id = `eq.${deviceId}`;
  return selectRows(config.supabase.envTable, params);
}

/**
 * Assemble the full dashboard payload:
 * { device_id, devices, latest(+ai_analysis), history:{data,count}, stats }
 */
export async function buildDashboard({ deviceId, hours, limit }) {
  const devices = await listDevices();
  // A requested id that no longer appears among known devices (stale
  // localStorage from a device that was renamed or retired) must not stick —
  // otherwise the client keeps re-requesting a device with no rows forever,
  // since `device_id` in the response is what the client trusts back.
  const resolved = (deviceId && devices.includes(deviceId) ? deviceId : devices[0]) ?? deviceId ?? null;

  let rows = await getHistory({ deviceId: resolved, hours, limit });
  if (!rows.length) {
    // Device offline longer than the window — fall back to the most recent
    // rows regardless of age so the charts never render empty (v3 behavior).
    const params = {
      order: 'created_at.desc',
      limit: String(Math.min(config.api.fallbackRows, limit)),
    };
    if (resolved) params.device_id = `eq.${resolved}`;
    rows = await selectRows(config.supabase.envTable, params);
  }
  const history = rows.map((r) => decorateRow(r));
  const latestRaw = rows[0] ?? (await getLatest(resolved));
  const latest = latestRaw ? decorateRow(latestRaw, { withAnalysis: true }) : null;

  return {
    device_id: resolved ?? latest?.device_id ?? null,
    devices,
    latest,
    history: { data: history, count: history.length },
    stats: computeStats(history, STAT_KEYS),
  };
}
