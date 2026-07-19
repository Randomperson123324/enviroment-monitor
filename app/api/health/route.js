import config from '@/config';
import { pingSupabase } from '@/lib/supabase';
import { listDevices } from '@/lib/dashboard';
import { geminiEnabled } from '@/lib/gemini';
import { jsonOk, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async () => {
  const supabase_ok = await pingSupabase();
  let devices = [];
  if (supabase_ok) {
    devices = await listDevices().catch(() => []);
  }
  return jsonOk({
    ok: true,
    supabase_ok,
    gemini_enabled: geminiEnabled(),
    model: config.gemini.model,
    devices,
    active_device: devices[0] ?? null,
    ts: new Date().toISOString(),
  });
});
