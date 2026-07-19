import config from '@/config';
import { jsonOk, jsonError, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gov — Thai government water/weather feeds, shared from the
 * StreeFlood app's own /api/gov endpoint (TMD, ThaiWater, RID).
 */
export const GET = withErrors(async () => {
  const { baseUrl, govPath, timeoutMs } = config.streeflood;
  const res = await fetch(`${baseUrl}${govPath}`, {
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  }).catch((e) => {
    throw new Error(`StreeFlood unreachable at ${baseUrl}: ${e.message}`);
  });
  if (!res.ok) return jsonError(`StreeFlood /api/gov HTTP ${res.status}`, 502);
  return jsonOk(await res.json());
});
