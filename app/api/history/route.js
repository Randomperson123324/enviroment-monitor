import { getHistory, clampHours, clampLimit, normalizeDeviceId } from '@/lib/dashboard';
import { decorateRow } from '@/lib/analysis';
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
  const data = rows.map((r) => decorateRow(r));
  return jsonOk({ data, count: data.length });
});
