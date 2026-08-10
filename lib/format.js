/** Small client-safe formatting helpers. */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * Break a duration into the largest sensible unit.
 * Returns `{ unit: 'now'|'min'|'hour'|'day', n }` so callers can translate it —
 * a raw minute count is unreadable past an hour or two ("31376 นาทีที่แล้ว").
 */
export function ageParts(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms < 2 * MINUTE) return { unit: 'now', n: 0 };
  if (ms < HOUR) return { unit: 'min', n: Math.round(ms / MINUTE) };
  if (ms < DAY) return { unit: 'hour', n: Math.round(ms / HOUR) };
  return { unit: 'day', n: Math.round(ms / DAY) };
}

/**
 * Localized age. `t` is the translate function from useLang.
 * `scope` picks the wording: `age` reads as a sentence ("3 ชม.ที่แล้ว"), while
 * `ageShort` is a bare duration ("3 ชม.") for labels that supply their own
 * framing — "ออฟไลน์ 3 ชม.ที่แล้ว" says the going-offline happened 3h ago,
 * which is not what a staleness pill means.
 */
export function formatAge(ms, t, scope = 'age') {
  const parts = ageParts(ms);
  return parts ? t(`${scope}.${parts.unit}`, { n: parts.n }) : '';
}

/** Relative Thai age string from a millisecond duration (server-side / logs). */
export function agoTh(ms) {
  const parts = ageParts(ms);
  if (!parts) return '';
  if (parts.unit === 'now') return 'เมื่อสักครู่';
  if (parts.unit === 'min') return `${parts.n} นาทีที่แล้ว`;
  if (parts.unit === 'hour') return `${parts.n} ชม.ที่แล้ว`;
  return `${parts.n} วันที่แล้ว`;
}

/** Relative Thai age from an ISO timestamp. */
export function agoFromTh(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? agoTh(Date.now() - t) : '';
}

export function timeTh(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString('th-TH', {
    hour12: false,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Absolute timestamp in the active language, e.g. "19/07 21:51". */
export function timestampLabel(iso, lang, { seconds = false } = {}) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString(lang === 'en' ? 'en-GB' : 'th-TH', {
    hour12: false,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });
}
