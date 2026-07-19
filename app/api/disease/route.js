import { getLatest, normalizeDeviceId } from '@/lib/dashboard';
import { assessDiseases } from '@/lib/disease';
import { jsonOk, query, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/disease — environmental disease-risk assessment for the latest
 * reading of a device. Rule-based with cited public-health sources.
 */
export const GET = withErrors(async (request) => {
  const reading = await getLatest(normalizeDeviceId(query(request).get('device_id'))).catch(
    () => null
  );
  return jsonOk({ ...assessDiseases(reading), reading: reading?.created_at ?? null });
});
