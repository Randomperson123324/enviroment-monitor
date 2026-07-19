import config from '@/config';
import { geminiEnabled } from '@/lib/gemini';
import { jsonOk, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * Public runtime config for the browser. The anon key is a public,
 * RLS-guarded key by design — but it still lives in env, not in source.
 */
export const GET = withErrors(async () => {
  const { client, supabase } = config;
  return jsonOk({
    ...client,
    geminiEnabled: geminiEnabled(),
    streefloodUrl: config.streeflood.baseUrl,
    focus: {
      ...client.focus,
      supabaseUrl: supabase.url,
      supabaseAnonKey: supabase.anonKey,
      table: supabase.focusTable,
    },
  });
});
