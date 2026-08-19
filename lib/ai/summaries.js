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
import { SENSORS } from '@/config/sensors';
import { translate } from '@/config/i18n';
import { aiSummarize } from '@/lib/ai';
import { getLatest, getHistory, normalizeDeviceId } from '@/lib/dashboard';
import { readingSummary, healthScore } from '@/lib/analysis';
import { assessDiseases } from '@/lib/disease';
import { selectRows } from '@/lib/supabase';
import { PROVIDERS } from '@/lib/ai/discovery';
import { mayReadFocus } from '@/lib/ai/tools';

const round = (n, d = 1) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);

/** min / max / mean of a numeric column, ignoring gaps (null ≠ 0). */
function spread(rows, key) {
  const vals = rows
    .filter((r) => r[key] != null && r[key] !== '')
    .map((r) => Number(r[key]))
    .filter(Number.isFinite);
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

  const trend = SENSORS.map((s) => s.field)
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

/**
 * The classroom-engagement picture, as text, plus the identities that text
 * contains.
 *
 * The second half matters because this context can now reach a cloud provider
 * with its names swapped for variables (lib/ai/aliases.js). That swap works off
 * a roster cached for five minutes, and the rows folded in here are the newest
 * ones — a student first recognised two minutes ago is in this text and not yet
 * in that roster. Handing the names over explicitly closes the gap at the only
 * place that can see it: here, holding the actual rows.
 */
async function focusContext() {
  const rows = await selectRows(config.supabase.focusTable, {
    order: 'created_at.desc',
    limit: String(config.ai.summary.focusRows),
  }).catch(() => []);
  if (!rows.length) return null;

  // Fold to per-person totals; the model gets aggregates, never raw frames.
  const byPerson = new Map();
  for (const r of rows) {
    // Key on the recognised name when there is one, matching get_focus_activity in
    // lib/ai/tools.js — otherwise the same person reads as two different subjects
    // depending on which of the two paths answered.
    const id = r.name ?? r.person ?? 'unknown';
    if (!byPerson.has(id)) {
      byPerson.set(id, { moves: 0, samples: 0, faces: 0, dirs: new Map(), posture: null, emotion: null });
    }
    const p = byPerson.get(id);
    p.moves += movementCount(r.movement);
    p.samples++;
    p.faces = Math.max(p.faces, r.face_count ?? 0);
    if (r.direction) p.dirs.set(r.direction, (p.dirs.get(r.direction) ?? 0) + 1);
    // Rows arrive newest-first, so the first one carrying a value is the latest.
    if (p.posture == null && r.posture) p.posture = r.posture_confident === true ? r.posture : `${r.posture}?`;
    if (p.emotion == null && r.emotion) p.emotion = r.emotion;
  }

  const times = rows.map((r) => Date.parse(r.created_at)).filter(Number.isFinite);
  const spanMin = times.length ? Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 60000)) : 0;

  const lines = [...byPerson.entries()]
    .sort((a, b) => b[1].moves - a[1].moves)
    .map(([id, p]) => {
      const dirs = [...p.dirs.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${n}`);
      const perMin = spanMin ? round(p.moves / spanMin, 2) : null;
      const state = [p.posture && `ท่าล่าสุด: ${p.posture}`, p.emotion && `อารมณ์ล่าสุด: ${p.emotion}`]
        .filter(Boolean)
        .join(' ');
      return (
        `บุคคล ${id}: ขยับรวม ${p.moves} ครั้ง (${perMin ?? '?'} ครั้ง/นาที) จาก ${p.samples} ตัวอย่าง ` +
        `ทิศทางที่พบ: ${dirs.join(', ') || '—'}${state ? ` · ${state}` : ''}`
      );
    });

  return {
    text: [
      `ข้อมูลกล้อง ${rows.length} แถว ครอบคลุม ${spanMin} นาที · ${byPerson.size} บุคคล`,
      ...lines,
    ].join('\n'),
    // Only the recognised names: a bare track id is already a pseudonym, and one
    // hunted for in prose would swallow every other "2" in the text — see
    // `searchable()` in lib/ai/aliases.js, which refuses them for that reason.
    identifiers: [...byPerson.keys()]
      .filter((id) => typeof id === 'string' && id !== 'unknown')
      .map((value) => ({ value, kind: 'NAME' })),
  };
}

/**
 * The room read as a health question: what it measures, and what those numbers
 * put the people in it at risk of.
 *
 * This used to lead with the national water picture — river levels, reservoirs,
 * rainfall upstream. None of it was about this room, and a summary that opened
 * on a reservoir three provinces away buried the one line that was actionable.
 */
async function healthContext(deviceId) {
  const latest = await getLatest(deviceId).catch(() => null);
  if (!latest) return null;

  const parts = [`สภาพห้องล่าสุด: ${readingSummary(latest)}`];
  const { risks } = assessDiseases(latest);

  if (risks.length) {
    parts.push(
      `ความเสี่ยงโรคจากสภาพห้อง: ${risks
        .map((d) => `${translate('th', d.nameKey)} (${d.level})`)
        .join(', ')}`
    );
    // The reasons are the difference between "ไข้หวัดใหญ่ (warning)" and a model
    // that can say *why* — they name the reading that raised each risk.
    for (const d of risks) {
      const because = (d.reasonKeys ?? []).map((k) => translate('th', k)).join(' · ');
      if (because) parts.push(`- ${translate('th', d.nameKey)}: ${because}`);
    }
  } else {
    parts.push('ยังไม่พบความเสี่ยงโรคจากสภาพห้องในขณะนี้');
  }

  return parts.join('\n');
}

/**
 * The providers this scope may fall back to, or null for "no narrowing".
 *
 * Derived from the same gate the chat tools use rather than restated, so the
 * policy has one home: while every configured provider may read camera data the
 * chain is left alone and the user's own order decides, and the moment one may
 * not — masking switched off, or a provider added outside the trusted list — the
 * summary is pinned to those that may, instead of being sent anyway.
 */
function focusChain() {
  const ids = Object.keys(PROVIDERS);
  const allowed = ids.filter(mayReadFocus);
  return allowed.length === ids.length ? null : allowed;
}

const SCOPES = {
  environment: { instruction: MSG.scopes.environment, build: environmentContext },
  focus: {
    instruction: MSG.scopes.focus,
    build: focusContext,
    only: focusChain(),
  },
  health: { instruction: MSG.scopes.health, build: healthContext },
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

  const { ttlMs, failureTtlMs } = config.ai.summary;
  /** A failed attempt expires quickly so a fixed key/URL takes effect soon. */
  const ttlOf = (data) => (data?.ok ? ttlMs : failureTtlMs);
  const key = `${scope}|${normalizeDeviceId(deviceId) ?? ''}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttlOf(hit.data)) {
    const ttl = ttlOf(hit.data);
    return { ...hit.data, cached: true, generatedAt: hit.at, nextRefreshAt: hit.at + ttl };
  }

  let data;
  try {
    // A builder returns text, or text plus the identities in it (see focusContext).
    const built = await def.build(normalizeDeviceId(deviceId));
    const { text: contextText, identifiers } = typeof built === 'string' ? { text: built } : built ?? {};
    data = contextText
      ? {
          ok: true,
          ...(await aiSummarize({
            instruction: def.instruction,
            contextText,
            identifiers,
            overrides,
            only: def.only,
          })),
        }
      : { ok: false, error: MSG.scopes.noData, pinned: def.only ?? null };
  } catch (err) {
    console.warn(`[ai/summary] ${scope} failed:`, err.message);
    data = { ok: false, error: err.message, pinned: def.only ?? null };
  }

  // Cache failures too, so a dead endpoint isn't retried on every tab switch.
  const at = Date.now();
  cache.set(key, { at, data });
  return { ...data, cached: false, generatedAt: at, nextRefreshAt: at + ttlOf(data) };
}
