import { buildDashboard, clampHours, clampLimit, normalizeDeviceId } from '@/lib/dashboard';
import { jsonOk, query, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (request) => {
  const q = query(request);
  const payload = await buildDashboard({
    deviceId: normalizeDeviceId(q.get('device_id')),
    hours: clampHours(q.get('hours')),
    limit: clampLimit(q.get('history_limit')),
  });
  return jsonOk(payload);
});
