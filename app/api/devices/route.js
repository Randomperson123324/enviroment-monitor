import { listDevices, normalizeDeviceId } from '@/lib/dashboard';
import { jsonOk, query, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (request) => {
  const q = query(request);
  const devices = await listDevices(q.get('hours') ?? undefined);
  const preferred = normalizeDeviceId(q.get('active'));
  const active = preferred && devices.includes(preferred) ? preferred : devices[0] ?? null;
  return jsonOk({ devices, active });
});
