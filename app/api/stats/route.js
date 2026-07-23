import { getHistory, clampHours, clampLimit, normalizeDeviceId } from '@/lib/dashboard';
import { decorateRow } from '@/lib/analysis';
import { computeStats, STAT_KEYS } from '@/lib/stats';
import { jsonOk, query, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/** Legacy endpoint kept for older clients. */
export const GET = withErrors(async (request) => {
  const q = query(request);
  const rows = await getHistory({
    deviceId: normalizeDeviceId(q.get('device_id')),
    hours: clampHours(q.get('hours')),
    limit: clampLimit(q.get('limit')),
  });
  return jsonOk(computeStats(rows.map((r) => decorateRow(r)), STAT_KEYS));
});
