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

  gemini: {
    apiKey: str('GEMINI_API_KEY'),
    model: str('GEMINI_MODEL', 'gemini-2.5-flash'),
    baseUrl: str('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
    timeoutMs: num('GEMINI_TIMEOUT_MS', 25000),
    maxOutputTokens: num('GEMINI_MAX_OUTPUT_TOKENS', 1024),
    /** Max chat-history turns forwarded to the model */
    maxHistoryTurns: num('GEMINI_MAX_HISTORY_TURNS', 10),
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
