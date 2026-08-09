/**
 * Server-side configuration — single source of truth for every tunable.
 * Import ONLY from server code (lib/, app/api/). Client defaults are
 * exposed through GET /api/config, never imported directly by the browser.
 */

const num = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
};
const str = (key, fallback = '') => (process.env[key] ?? '').trim() || fallback;
const bool = (key, fallback) => {
  const v = (process.env[key] ?? '').trim().toLowerCase();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
};
/** Comma-separated env list → array of trimmed entries (empty → fallback). */
const list = (key, fallback) => {
  const parts = (process.env[key] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : fallback;
};

const config = {
  supabase: {
    url: str('SUPABASE_URL'),
    anonKey: str('SUPABASE_ANON_KEY'),
    envTable: str('SUPABASE_ENV_TABLE', 'environment'),
    focusTable: str('SUPABASE_FOCUS_TABLE', 'focus'),
    timeoutMs: num('SUPABASE_TIMEOUT_MS', 10000),
  },

  /**
   * Flood-warning data bridge (StreeFlood project). Defaults to this app's
   * own Supabase, where the shared `sensors` + `water_readings` tables live;
   * point FLOOD_SUPABASE_URL/KEY at the original StreeFlood project instead
   * once that database is active again.
   */
  flood: {
    url: str('FLOOD_SUPABASE_URL', str('SUPABASE_URL')),
    anonKey: str('FLOOD_SUPABASE_ANON_KEY', str('SUPABASE_ANON_KEY')),
    sensorsTable: str('FLOOD_SENSORS_TABLE', 'sensors'),
    readingsTable: str('FLOOD_READINGS_TABLE', 'water_readings'),
    /** Readings pulled per sensor for the trend regression */
    trendReadings: num('FLOOD_TREND_READINGS', 24),
    trendWindowHours: num('FLOOD_TREND_WINDOW_HOURS', 3),
    /** |cm/hour| below this counts as "stable" (mirrors StreeFlood) */
    stableRateCmPerHour: num('FLOOD_STABLE_RATE', 0.3),
    /** A latest reading older than this is flagged stale and excluded from the live summary */
    staleAfterHours: num('FLOOD_STALE_AFTER_HOURS', 6),
    timeoutMs: num('FLOOD_TIMEOUT_MS', 10000),
  },

  /** StreeFlood site — only linked from the UI now (its /api/gov cannot be
   *  proxied server-to-server: Vercel's bot challenge answers with HTTP 429). */
  streeflood: {
    baseUrl: str('STREEFLOOD_BASE_URL', 'https://streeflood.vercel.app'),
  },

  /**
   * Government water/weather feeds, fetched directly (ported from StreeFlood's
   * lib/gov). TMD's demo uid/ukey works but is shared/rate-limited — register
   * at data.tmd.go.th for your own. Server-side only.
   */
  gov: {
    tmdUid: str('TMD_UID', 'demo'),
    tmdUkey: str('TMD_UKEY', 'demokey'),
    tmdBase: str('TMD_BASE_URL', 'https://data.tmd.go.th/api'),
    thaiwaterBase: str(
      'THAIWATER_BASE_URL',
      'https://api-v3.thaiwater.net/api/v1/thaiwater30/public'
    ),
    ridReservoirUrl: str(
      'RID_RESERVOIR_URL',
      'https://app.rid.go.th/reservoir/api/reservoir/public'
    ),
    /** Upstream cache window — the rain feed is ~4.5 MB; be polite to free gov APIs. */
    revalidateSeconds: num('GOV_REVALIDATE_SECONDS', 900),
    rainTopStations: num('GOV_RAIN_TOP_STATIONS', 10),
    riverStations: num('GOV_RIVER_STATIONS', 8),
    reservoirTop: num('GOV_RESERVOIR_TOP', 8),
    /** app.rid.go.th intermittently refuses connections, then works — retry. */
    ridFetchAttempts: num('GOV_RID_FETCH_ATTEMPTS', 3),
  },

  /**
   * AI providers, tried in `order` until one answers; if all fail the callers
   * fall back to the local rule engine in lib/analysis.js. Every provider is
   * reachable server-side only — the local endpoint is plain HTTP, so a browser
   * on an HTTPS page cannot call it directly (mixed content).
   *
   * No model id is hardcoded for the local provider: an empty `model` means
   * "ask the endpoint which one is loaded" (see lib/ai/discovery.js).
   */
  ai: {
    order: list('AI_PROVIDER_ORDER', ['local', 'gemini']),

    /**
     * OpenAI-compatible endpoint (llama-swap / llama.cpp / LM Studio / Ollama).
     * `thinking: false` matters: the default model there is a reasoning model,
     * and with thinking on it spends its whole token budget in
     * `reasoning_content`, returning an empty `content`. See docs/06-ai-providers.md.
     */
    local: {
      baseUrl: str('AI_LOCAL_BASE_URL', 'http://kagenou.serveminecraft.net:2000'),
      /** '' = auto-discover the currently loaded model */
      model: str('AI_LOCAL_MODEL', ''),
      /** llama-swap needs no key; kept for LM Studio / gateway parity */
      apiKey: str('AI_LOCAL_API_KEY'),
      thinking: bool('AI_LOCAL_THINKING', false),
      /** Generous: a request for an unloaded model triggers a cold model swap */
      timeoutMs: num('AI_LOCAL_TIMEOUT_MS', 120000),
      maxTokens: num('AI_LOCAL_MAX_TOKENS', 2048),
    },

    gemini: {
      apiKey: str('GEMINI_API_KEY'),
      model: str('GEMINI_MODEL', 'gemini-3.5-flash-lite'),
      baseUrl: str('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
      timeoutMs: num('GEMINI_TIMEOUT_MS', 25000),
      maxTokens: num('GEMINI_MAX_OUTPUT_TOKENS', 1024),
    },

    /**
     * Hosted deployment used as an outbound relay. Set on a machine that cannot
     * reach the providers itself (venue Wi-Fi, raw-IP demo box) — its AI routes
     * then forward to this origin instead of calling the models directly.
     */
    relay: {
      url: str('AI_RELAY_URL'),
      timeoutMs: num('AI_RELAY_TIMEOUT_MS', 130000),
    },

    /**
     * Per-tab AI summaries. Generated at most once per `ttlMs` and served from
     * cache in between, so opening a tab never costs a model call.
     */
    summary: {
      ttlMs: num('AI_SUMMARY_TTL_MS', 30 * 60 * 1000),
      maxRecs: num('AI_SUMMARY_MAX_RECS', 4),
      /** Rows of camera history folded into the focus summary */
      focusRows: num('AI_SUMMARY_FOCUS_ROWS', 200),
      /** Look-back window for the environment trend line */
      envHours: num('AI_SUMMARY_ENV_HOURS', 6),
      /**
       * Focus is pinned to the on-device endpoint: camera data never leaves the
       * network, so a failure is reported rather than retried against Gemini.
       */
      focusProviders: list('AI_SUMMARY_FOCUS_PROVIDERS', ['local']),
    },

    /** Max chat-history turns forwarded to the model */
    maxHistoryTurns: num('AI_MAX_HISTORY_TURNS', num('GEMINI_MAX_HISTORY_TURNS', 10)),
    /** Server-side cache for the providers' model lists */
    modelCacheMs: num('AI_MODEL_CACHE_MS', 60000),
    /**
     * Whether x-ai-* request headers may override endpoints/keys/models. Handy
     * for the demo (everything is settable from the browser), but it lets a
     * caller point the server at an arbitrary URL — turn off for public hosts.
     */
    allowClientOverrides: bool('AI_ALLOW_CLIENT_OVERRIDES', true),
  },

  api: {
    defaultHours: num('API_DEFAULT_HOURS', 24),
    maxHours: num('API_MAX_HOURS', 168),
    defaultHistoryLimit: num('API_DEFAULT_HISTORY_LIMIT', 200),
    maxHistoryLimit: num('API_MAX_HISTORY_LIMIT', 1000),
    /** How many recent rows to scan when discovering device ids */
    deviceScanLimit: num('API_DEVICE_SCAN_LIMIT', 1000),
    /** Lookback window (hours) for device discovery */
    deviceLookbackHours: num('API_DEVICE_LOOKBACK_HOURS', 168),
    /** Rows returned when the requested window has no data (device offline) */
    fallbackRows: num('API_FALLBACK_ROWS', 40),
  },

  /** Values shipped to the browser via GET /api/config (no secrets beyond the public anon key). */
  client: {
    pollMsDefault: num('CLIENT_POLL_MS_DEFAULT', 5000),
    pollMsMin: num('CLIENT_POLL_MS_MIN', 3000),
    pollMsMax: num('CLIENT_POLL_MS_MAX', 60000),
    healthPollMs: num('CLIENT_HEALTH_POLL_MS', 30000),
    floodRefreshMs: num('CLIENT_FLOOD_REFRESH_MS', 60000),
    govRefreshMs: num('CLIENT_GOV_REFRESH_MS', 300000),
    /** How often a tab re-asks for its summary; the server serves cache until ttlMs is up. */
    aiSummaryPollMs: num('CLIENT_AI_SUMMARY_POLL_MS', 30 * 60 * 1000),
    focus: {
      fetchLimit: num('FOCUS_FETCH_LIMIT', 120),
      pollMs: num('FOCUS_POLL_MS', 20000),
      realtimeRetryMs: num('FOCUS_REALTIME_RETRY_MS', 15000),
      realtimeHeartbeatMs: num('FOCUS_REALTIME_HEARTBEAT_MS', 25000),
      thresholdDefault: num('FOCUS_THRESHOLD_DEFAULT', 8),
      bucketMs: num('FOCUS_BUCKET_MS', 60000),
      chartBuckets: num('FOCUS_CHART_BUCKETS', 30),
    },
  },
};

export default config;
