import { getLatest, normalizeDeviceId } from '@/lib/dashboard';
import { decorateRow } from '@/lib/analysis';
import { jsonOk, jsonError, query, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/** Legacy endpoint kept for device firmware / older clients. */
export const GET = withErrors(async (request) => {
  const row = await getLatest(normalizeDeviceId(query(request).get('device_id')));
  if (!row) return jsonError('no data', 404);
  return jsonOk(decorateRow(row, { withAnalysis: true }));
});
