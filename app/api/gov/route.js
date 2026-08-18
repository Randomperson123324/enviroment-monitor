import { getGovData } from '@/lib/gov';
import { jsonOk, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gov — Thai government water feeds (ThaiWater, RID),
 * fetched directly from the agencies (ported from StreeFlood's lib/gov —
 * proxying the deployed StreeFlood site is blocked by Vercel's bot challenge).
 */
export const GET = withErrors(async () => jsonOk(await getGovData()));
