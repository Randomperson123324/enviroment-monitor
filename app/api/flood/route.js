import { getFloodStatus, floodConfigured } from '@/lib/flood';
import { jsonOk, jsonError, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/** GET /api/flood — water-level snapshot shared from the StreeFlood project. */
export const GET = withErrors(async () => {
  if (!floodConfigured()) return jsonError('flood bridge not configured', 503);
  return jsonOk(await getFloodStatus());
});
