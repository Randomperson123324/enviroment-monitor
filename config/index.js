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

/**
 * Which providers may see camera/focus data at all — the app's one hard data
 * boundary. Read by both the per-tab summaries and the chat tools, so there is a
 * single list to change and no way for the two to disagree.
 *
 * The old name is still honoured: this rule started life as a summary-only
 * setting, and an existing deployment must not silently widen when it upgrades.
 *
 * `browser` is the WebGPU engine running inside the user's own browser. It is on
 * the list because the rule is about data leaving the device, and that engine
 * sends nothing anywhere — the focus rows are already fetched into that same
 * browser by the Focus tab, straight from Supabase. Remove it if the policy you
 * actually want is "camera data stays on the Pi and the server".
 */
const FOCUS_PROVIDERS = list('AI_FOCUS_PROVIDERS', list('AI_SUMMARY_FOCUS_PROVIDERS', ['local', 'browser']));

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
      /**
       * Failures are cached too (a dead endpoint must not be hammered on every
       * tab switch) but for far less time than a good answer: fixing a key or a
       * URL should show up in a couple of minutes, not half an hour.
       */
      failureTtlMs: num('AI_SUMMARY_FAILURE_TTL_MS', 2 * 60 * 1000),
      maxRecs: num('AI_SUMMARY_MAX_RECS', 4),
      /** Rows of camera history folded into the focus summary */
      focusRows: num('AI_SUMMARY_FOCUS_ROWS', 200),
      /** Look-back window for the environment trend line */
      envHours: num('AI_SUMMARY_ENV_HOURS', 6),
      /**
       * Focus is pinned to the on-device endpoint: camera data never leaves the
       * network, so a failure is reported rather than retried against Gemini.
       */
      focusProviders: FOCUS_PROVIDERS,
    },

    /**
     * Wall-clock budget for one request's whole provider chain, and the least
     * time worth giving a provider.
     *
     * Without this the first provider's own timeout could consume the request:
     * a local endpoint that is merely unreachable takes ~10s to fail on connect,
     * and with AI_LOCAL_TIMEOUT_MS at two minutes a serverless function hits its
     * own limit long before Gemini is ever asked — which reads to the user as
     * "the cloud provider does not work" while it is perfectly fine.
     */
    chainBudgetMs: num('AI_CHAIN_BUDGET_MS', 20000),
    minAttemptMs: num('AI_MIN_ATTEMPT_MS', 1500),
    /**
     * How many alternative models to try after a pinned one is refused. More than
     * one because a provider's list order is not usefulness order, but bounded:
     * each rejection is cheap, yet a quota-based refusal is worth respecting
     * rather than hammering down the whole list.
     */
    modelRetryMax: num('AI_MODEL_RETRY_MAX', 3),

    /** Providers allowed to hold camera data — see FOCUS_PROVIDERS above. */
    focusProviders: FOCUS_PROVIDERS,

    /**
     * Tool calling. The assistant is given tools instead of a prompt with data
     * pasted into it, so it can ask for what a question actually needs.
     *
     * `maxRounds` bounds the model→tool→model loop. Two is not enough for a
     * question that needs the room *and* the forecast; unbounded lets a confused
     * model spend a whole request calling the same tool forever.
     */
    tools: {
      enabled: bool('AI_TOOLS_ENABLED', true),
      maxRounds: num('AI_TOOLS_MAX_ROUNDS', 4),
      /** Per-turn ceiling on tool calls, across all rounds. */
      maxCalls: num('AI_TOOLS_MAX_CALLS', 8),
    },

    /**
     * Web search (Tavily), reachable only through the assistant's search toggle.
     * Without a key the tool is never offered, so the model cannot promise a
     * search it has no way to run.
     */
    search: {
      apiKey: str('TAVILY_API_KEY'),
      baseUrl: str('TAVILY_BASE_URL', 'https://api.tavily.com'),
      maxResults: num('TAVILY_MAX_RESULTS', 5),
      depth: str('TAVILY_DEPTH', 'basic'),
      timeoutMs: num('TAVILY_TIMEOUT_MS', 15000),
    },

    /**
     * The model that runs in the user's browser on the GPU (WebGPU/WebLLM).
     *
     * Nothing here is a secret or an endpoint: the weights come from the MLC CDN
     * to the browser directly, and the server's only part is assembling the
     * snapshot prompt (`lib/ai/context.js`) that the model is given, because a
     * 4-bit model of this size cannot be trusted to call tools.
     */
    browser: {
      enabled: bool('AI_BROWSER_ENABLED', true),
      /** Rows of camera history folded into the browser engine's prompt. Far
       *  fewer than the summary's: its whole context window is 4096 tokens. */
      focusRows: num('AI_BROWSER_FOCUS_ROWS', 60),
    },

    /**
     * Streaming chat. The reply is written as it is generated, and a reasoning
     * model's thoughts can be shown while it works — a 20-second wait with a
     * blinking dot is indistinguishable from a hang.
     */
    stream: {
      enabled: bool('AI_STREAM_ENABLED', true),
      /** Total wall clock for one streamed turn, tool rounds included. */
      budgetMs: num('AI_STREAM_BUDGET_MS', 120000),
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
