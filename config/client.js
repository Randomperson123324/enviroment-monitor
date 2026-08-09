/**
 * Client-side constants: storage keys, chart view options, and the validated
 * chart palette (dataviz reference palette — checked with the palette validator
 * for CVD separation and surface contrast in both modes).
 * Env-dependent values (Supabase URL/key, poll defaults) arrive via GET /api/config.
 */

export const STORAGE = {
  theme: 'em_theme',
  apiBase: 'em_api_base',
  geminiKey: 'em_gemini_key',
  /** AI overrides — blank means "use whatever the server is configured with". */
  aiOrder: 'em_ai_order',
  aiLocalBase: 'em_ai_local_base',
  aiLocalModel: 'em_ai_local_model',
  aiGeminiBase: 'em_ai_gemini_base',
  aiGeminiModel: 'em_ai_gemini_model',
  aiRelay: 'em_ai_relay',
  pollMs: 'em_poll_ms',
  deviceId: 'em_device_id',
  chartHours: 'em_chart_hours',
  chartSmooth: 'em_chart_smooth',
  focusThreshold: 'em_focus_threshold',
  activeTab: 'em_active_tab',
  lang: 'em_lang',
};

/** Dashboard sections, grouped by the top-level menu. */
export const TABS = [
  { id: 'environment', label: 'Environment' },
  { id: 'focus', label: 'Focus' },
  { id: 'hydro', label: 'Safety & Health' },
];

/**
 * Provider-priority presets offered in Dev Settings. `value` is sent verbatim as
 * the x-ai-order header; '' means "don't override, follow the server's order".
 */
export const AI_ORDER_PRESETS = [
  { value: '', key: 'server' },
  { value: 'local,gemini', key: 'localFirst' },
  { value: 'gemini,local', key: 'geminiFirst' },
  { value: 'local', key: 'localOnly' },
  { value: 'gemini', key: 'geminiOnly' },
];

export const CHART_RANGES = [
  { h: 1, label: '1 ชม.' },
  { h: 6, label: '6 ชม.' },
  { h: 12, label: '12 ชม.' },
  { h: 24, label: '24 ชม.' },
  { h: 72, label: '3 วัน' },
];

export const SMOOTH_OPTIONS = [
  { value: 1, key: 'raw', label: 'ดิบ' },
  { value: 3, key: 'light', label: 'เบา' },
  { value: 5, key: 'medium', label: 'กลาง' },
  { value: 9, key: 'smooth', label: 'ลื่น' },
];

export const CHART_VIEW_DEFAULTS = {
  hours: 24,
  smooth: 5,
  maxPoints: 200,
  /** Divisor applied to gas so it shares the main chart's axis (labeled "Gas÷10"). */
  gasAxisDivisor: 10,
};

export const LOG_MAX_ROWS = 120;
/** Rows shown in gov-data lists before "ดูทั้งหมด" expands them. */
export const GOV_COLLAPSED_ROWS = 3;
export const CHAT_MAX_TURNS = 20;

/** Header freshness indicator: minutes before the reading turns amber/red. */
export const DATA_AGE = {
  freshMin: 3,
  staleMin: 15,
  /** Re-render cadence of the age label */
  tickMs: 10000,
};

/** Bounds for the focus "movement per minute" threshold input. */
export const FOCUS_THRESHOLD_INPUT = { min: 1, max: 99 };

/**
 * Fallbacks if GET /api/config is unreachable (server values win).
 * `focus` mirrors the server-side defaults in config/index.js so components
 * never need their own inline `?? n` fallbacks; without supabaseUrl/key from
 * the server the focus feed simply stays disconnected.
 */
export const CLIENT_FALLBACK = {
  pollMsDefault: 5000,
  pollMsMin: 3000,
  pollMsMax: 60000,
  healthPollMs: 30000,
  floodRefreshMs: 60000,
  govRefreshMs: 300000,
  geminiEnabled: false,
  ai: {
    order: ['local', 'gemini'],
    available: [],
    localBaseUrl: '',
    localModel: '',
    geminiBaseUrl: '',
    geminiModel: '',
    relayConfigured: false,
    allowClientOverrides: true,
  },
  focus: {
    fetchLimit: 120,
    pollMs: 20000,
    realtimeRetryMs: 15000,
    realtimeHeartbeatMs: 25000,
    thresholdDefault: 8,
    bucketMs: 60000,
    chartBuckets: 30,
  },
  streefloodUrl: '',
};

/** Validated chart palette (series hexes unchanged; chrome matches the soft surfaces). */
export const CHART_COLORS = {
  light: {
    temp: '#e34948',
    hum: '#2a78d6',
    gas: '#eda100',
    score: '#1baf7a',
    focus: '#4a3aa7',
    focusOver: '#d03b3b',
    grid: 'rgba(15,55,75,0.10)',
    tick: '#567586',
    tooltipBg: 'rgba(255,255,255,0.92)',
    tooltipInk: '#091e2c',
    border: 'rgba(15,55,75,0.15)',
  },
  dark: {
    temp: '#e66767',
    hum: '#3987e5',
    gas: '#c98500',
    score: '#199e70',
    focus: '#9085e9',
    focusOver: '#d03b3b',
    grid: 'rgba(158,190,205,0.14)',
    tick: '#9ebecd',
    tooltipBg: 'rgba(26,48,68,0.95)',
    tooltipInk: '#e8f4fa',
    border: 'rgba(255,255,255,0.12)',
  },
};

/**
 * Categorical palette for per-entity series (one colour per person/Face ID in the
 * Focus chart). These are the dataviz reference palette's 8 CVD-safe slots in their
 * fixed order — validated with scripts/validate_palette.js for both modes. Assign a
 * slot to an entity by stable order and never cycle: a 9th ID folds into "+N more"
 * rather than reusing slot 1's colour. Because colours sit in the CVD floor band,
 * they must always be paired with a text label (the ID legend), never colour alone.
 */
export const ID_SERIES_PALETTE = {
  light: ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'],
  dark: ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'],
};

/** Status palette (fixed, never themed). */
export const STATUS_COLORS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

/**
 * Health-score ring palette, keyed by SCORE_BANDS id (thresholds live there —
 * never restate cutoffs in UI code). Light mode darkens the two mid tones for
 * contrast on the pale surface.
 */
export const SCORE_BAND_COLORS = {
  excellent: { light: '#157a57', dark: '#1baf7a' },
  good: { light: STATUS_COLORS.good, dark: STATUS_COLORS.good },
  fair: { light: '#8a5a00', dark: STATUS_COLORS.warning },
  poor: { light: STATUS_COLORS.serious, dark: STATUS_COLORS.serious },
  critical: { light: STATUS_COLORS.critical, dark: STATUS_COLORS.critical },
};

/** Hex → rgba with alpha (for chart fills). */
export function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
