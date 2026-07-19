/** Small client-safe formatting helpers (Thai locale). */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Relative Thai age string from a millisecond duration. */
export function agoTh(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  if (ms < 2 * MINUTE) return 'เมื่อสักครู่';
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} นาทีที่แล้ว`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} ชม.ที่แล้ว`;
  return `${Math.round(ms / DAY)} วันที่แล้ว`;
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
