/**
 * Per-tab AI summaries.
 *
 * Each scope gathers its own context server-side, hands it to the model, and the
 * result is cached for config.ai.summary.ttlMs (30 min by default). Opening a
 * tab therefore costs nothing until the window is up — the model runs on a
 * schedule, not on every render.
 *
 * Cache note: this is per-process memory. On a serverless host each instance
 * keeps its own copy, so the effective refresh rate is per instance rather than
 * globally exact. That is fine for a summary; it is not a rate limiter.
 */
import config from '@/config';
import { MSG } from '@/config/messages.th';
import { translate } from '@/config/i18n';
import { aiSummarize } from '@/lib/ai';
import { getLatest, getHistory, normalizeDeviceId } from '@/lib/dashboard';
import { readingSummary, healthScore } from '@/lib/analysis';
import { assessDiseases } from '@/lib/disease';
import { getFloodStatus } from '@/lib/flood';
import { getGovData } from '@/lib/gov';
import { selectRows } from '@/lib/supabase';

const round = (n, d = 1) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);

/** min / max / mean of a numeric column, ignoring gaps. */
function spread(rows, key) {
  const vals = rows.map((r) => Number(r[key])).filter(Number.isFinite);
  if (!vals.length) return null;
  const sum = vals.reduce((a, v) => a + v, 0);
  return { min: round(Math.min(...vals)), max: round(Math.max(...vals)), avg: round(sum / vals.length) };
}

async function environmentContext(deviceId) {
  const latest = await getLatest(deviceId).catch(() => null);
  if (!latest) return null;

  const { envHours } = config.ai.summary;
  const rows = await getHistory({ deviceId, hours: envHours, limit: config.api.defaultHistoryLimit })
    .catch(() => []);

  const trend = ['temperature', 'humidity', 'gas_ppm']
    .map((key) => {
      const s = spread(rows, key);
      return s ? `${key}: ต่ำสุด ${s.min} สูงสุด ${s.max} เฉลี่ย ${s.avg}` : null;
    })
    .filter(Boolean);

  return [
    `ค่าล่าสุด: ${readingSummary(latest)}`,
    `คะแนนสุขภาพห้อง: ${healthScore(latest)}/100`,
    trend.length ? `แนวโน้ม ${envHours} ชั่วโมงที่ผ่านมา (${rows.length} ค่า):\n${trend.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Normalize movement whether stored as a number or an object of counts. */
function movementCount(m) {
  if (typeof m === 'number') return m;
  if (m && typeof m === 'object') return Object.values(m).reduce((a, v) => a + (Number(v) || 0), 0);
  return Number(m) || 0;
}

async function focusContext() {
  const rows = await selectRows(config.supabase.focusTable, {
    order: 'created_at.desc',
    limit: String(config.ai.summary.focusRows),
  }).catch(() => []);
  if (!rows.length) return null;

  // Fold to per-person totals; the model gets aggregates, never raw frames.
  const byPerson = new Map();
  for (const r of rows) {
    const id = r.person ?? 'unknown';
    if (!byPerson.has(id)) byPerson.set(id, { moves: 0, samples: 0, faces: 0, dirs: new Map() });
    const p = byPerson.get(id);
    p.moves += movementCount(r.movement);
    p.samples++;
    p.faces = Math.max(p.faces, r.face_count ?? 0);
    if (r.direction) p.dirs.set(r.direction, (p.dirs.get(r.direction) ?? 0) + 1);
  }

  const times = rows.map((r) => Date.parse(r.created_at)).filter(Number.isFinite);
  const spanMin = times.length ? Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 60000)) : 0;

  const lines = [...byPerson.entries()]
    .sort((a, b) => b[1].moves - a[1].moves)
    .map(([id, p]) => {
      const dirs = [...p.dirs.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${n}`);
      const perMin = spanMin ? round(p.moves / spanMin, 2) : null;
      return `บุคคล ${id}: ขยับรวม ${p.moves} ครั้ง (${perMin ?? '?'} ครั้ง/นาที) จาก ${p.samples} ตัวอย่าง ทิศทางที่พบ: ${dirs.join(', ') || '—'}`;
    });

  return [
    `ข้อมูลกล้อง ${rows.length} แถว ครอบคลุม ${spanMin} นาที · ${byPerson.size} บุคคล`,
    ...lines,
  ].join('\n');
}

async function hydroContext(deviceId) {
  const [flood, gov, latest] = await Promise.all([
    getFloodStatus().catch(() => null),
    getGovData().catch(() => null),
    getLatest(deviceId).catch(() => null),
  ]);

  const parts = [];

  const s = flood?.summary;
  if (s) {
    parts.push(
      `จุดวัดน้ำ: ทั้งหมด ${s.total} · อันตราย ${s.danger} · เฝ้าระวัง ${s.warning} · ไม่มีข้อมูล/ค้าง ${s.stale + s.noData}`
    );
  }
  if (gov?.waterWarnings?.length) {
    parts.push(`ประกาศเตือนน้ำ ${gov.waterWarnings.length} รายการ`);
  }
  const rain = gov?.rainfall?.slice(0, 3) ?? [];
  if (rain.length) {
    parts.push(
      `ฝน 24 ชม. สูงสุด: ${rain
        .map((r) => `${r.stationName || '?'} จ.${r.province?.th ?? ''} ${round(Number(r.rain24h))} มม.`)
        .join(', ')}`
    );
  }
  const river = gov?.riverSituation;
  if (river?.overflowCount != null || river?.highCount != null) {
    parts.push(`แม่น้ำ: ล้นตลิ่ง ${river.overflowCount ?? 0} · น้ำมาก ${river.highCount ?? 0} สถานี`);
  }
  const res = gov?.reservoirs;
  if (res?.totalReservoirs != null) {
    parts.push(
      `เขื่อน/อ่างเก็บน้ำ ${res.totalReservoirs} แห่ง · เกินความจุ ${res.overCapacityCount ?? 0} · น้ำมาก ${res.highCount ?? 0}`
    );
  }

  if (latest) parts.push(`สภาพห้องล่าสุด: ${readingSummary(latest)}`);
  const { risks } = assessDiseases(latest);
  if (risks.length) {
    parts.push(
      `ความเสี่ยงโรคจากสภาพห้อง: ${risks
        .map((d) => `${translate('th', d.nameKey)} (${d.level})`)
        .join(', ')}`
    );
  }

  return parts.length ? parts.join('\n') : null;
}

const SCOPES = {
  environment: { instruction: MSG.scopes.environment, build: environmentContext },
  focus: {
    instruction: MSG.scopes.focus,
    build: focusContext,
    only: config.ai.summary.focusProviders,
  },
  hydro: { instruction: MSG.scopes.hydro, build: hydroContext },
};

export const SCOPE_IDS = Object.keys(SCOPES);

/** scope|device → { at, data } */
const cache = new Map();

/**
 * Cached summary for a tab. Returns the payload plus cache metadata; `force`
 * skips the cache. A failure is returned, never thrown, so a pinned scope can
 * report "the on-device model is unavailable" instead of falling back.
 */
export async function getSummary(scope, { deviceId, overrides = {}, force = false } = {}) {
  const def = SCOPES[scope];
  if (!def) throw new Error(`unknown scope "${scope}"`);

  const { ttlMs } = config.ai.summary;
  const key = `${scope}|${normalizeDeviceId(deviceId) ?? ''}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttlMs) {
    return { ...hit.data, cached: true, generatedAt: hit.at, nextRefreshAt: hit.at + ttlMs };
  }

  let data;
  try {
    const contextText = await def.build(normalizeDeviceId(deviceId));
    data = contextText
      ? { ok: true, ...(await aiSummarize({ instruction: def.instruction, contextText, overrides, only: def.only })) }
      : { ok: false, error: MSG.scopes.noData, pinned: def.only ?? null };
  } catch (err) {
    console.warn(`[ai/summary] ${scope} failed:`, err.message);
    data = { ok: false, error: err.message, pinned: def.only ?? null };
  }

  // Cache failures too, so a dead endpoint isn't retried on every tab switch.
  const at = Date.now();
  cache.set(key, { at, data });
  return { ...data, cached: false, generatedAt: at, nextRefreshAt: at + ttlMs };
}
