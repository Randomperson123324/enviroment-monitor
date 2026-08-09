import config from '@/config';
import { pingSupabase } from '@/lib/supabase';
import { listDevices } from '@/lib/dashboard';
import { aiStatus } from '@/lib/ai';
import { jsonOk, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async () => {
  const supabase_ok = await pingSupabase();
  let devices = [];
  if (supabase_ok) {
    devices = await listDevices().catch(() => []);
  }
  const ai = aiStatus();
  return jsonOk({
    ok: true,
    supabase_ok,
    ai_enabled: ai.available.length > 0,
    ai_providers: ai.available,
    /** Retained for older clients that only knew about Gemini */
    gemini_enabled: ai.available.includes('gemini'),
    model: config.ai.gemini.model,
    devices,
    active_device: devices[0] ?? null,
    ts: new Date().toISOString(),
  });
});
