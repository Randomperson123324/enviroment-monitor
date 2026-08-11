import config from '@/config';
import { aiStatus } from '@/lib/ai';
import { providerSettings } from '@/lib/ai/discovery';
import { searchConfigured } from '@/lib/ai/search';
import { jsonOk, withErrors } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * Public runtime config for the browser. The anon key is a public,
 * RLS-guarded key by design — but it still lives in env, not in source.
 * AI settings expose endpoints and model *preferences* only, never keys.
 */
export const GET = withErrors(async () => {
  const { client, supabase } = config;
  const status = aiStatus();
  const local = providerSettings('local');
  const gemini = providerSettings('gemini');

  return jsonOk({
    ...client,
    geminiEnabled: status.available.includes('gemini'),
    streefloodUrl: config.streeflood.baseUrl,
    ai: {
      order: status.order,
      available: status.available,
      localBaseUrl: local.baseUrl,
      /** '' means the server auto-discovers whichever model is loaded */
      localModel: local.model,
      geminiBaseUrl: gemini.baseUrl,
      geminiModel: gemini.model,
      relayConfigured: Boolean(config.ai.relay.url),
      allowClientOverrides: config.ai.allowClientOverrides,
      /**
       * What the assistant's buttons may offer. `searchConfigured` is the honest
       * answer to "can this deployment search?" — without it the toggle would
       * promise a tool the server never hands to the model.
       */
      streaming: config.ai.stream.enabled,
      toolsEnabled: config.ai.tools.enabled,
      searchConfigured: searchConfigured(),
    },
    focus: {
      ...client.focus,
      supabaseUrl: supabase.url,
      supabaseAnonKey: supabase.anonKey,
      table: supabase.focusTable,
    },
  });
});
