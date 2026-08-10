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
  /** How AI summaries are rendered — see AI_SUMMARY_STYLES */
  aiSummaryStyle: 'em_ai_summary_style',
  pollMs: 'em_poll_ms',
  deviceId: 'em_device_id',
  chartHours: 'em_chart_hours',
  chartSmooth: 'em_chart_smooth',
  focusThreshold: 'em_focus_threshold',
  /** Assistant window: docked/floating, its width, and its floating rect. */
  aiWindow: 'em_ai_window',
  activeTab: 'em_active_tab',
  /** Which half of the safety tab was last shown (see HYDRO_VIEWS). */
  hydroView: 'em_hydro_view',
  lang: 'em_lang',
};

/**
 * Dashboard sections, grouped by the top-level menu. Names live in
 * config/i18n.js under `tabs.<id>` so both languages get them — they used to be
 * English literals here and stayed English with the UI switched to Thai.
 */
export const TABS = [{ id: 'environment' }, { id: 'focus' }, { id: 'hydro' }];

/**
 * The safety tab covers two unrelated questions — the water/weather situation
 * outside, and the illness risk from conditions in the room. They are one tab
 * because both answer "is it safe", but showing both at once made a long scroll
 * of things you were not looking for, so the tab picks one.
 */
export const HYDRO_VIEWS = [{ id: 'water' }, { id: 'disease' }];

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

/**
 * Presentation of AI summaries. Purely client-side: both styles render the same
 * cached payload, so switching never triggers a new generation.
 */
export const AI_SUMMARY_STYLES = [
  { value: 'blocks', key: 'blocks' },
  { value: 'markdown', key: 'markdown' },
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
};

export const LOG_MAX_ROWS = 120;
/**
 * Classification cutoffs for gov-feed rows, used to tone the UI.
 * These mirror ThaiWater's and RID's official scales and must stay in step with
 * the server-side constants in lib/gov.js, which do the actual counting —
 * lib/gov.js can't be imported here because it pulls in server config.
 */
export const GOV_LEVELS = {
  /** ThaiWater situation scale: 4 = high (น้ำมาก), 5 = overflowing (ล้นตลิ่ง) */
  riverHigh: 4,
  riverOverflow: 5,
  /** RID storage: >100% of capacity = over capacity, 81–100% = high */
  reservoirHighPercent: 81,
  reservoirOverPercent: 100,
};

export const CHAT_MAX_TURNS = 20;

/**
 * Freshness thresholds for the newest reading, in minutes.
 * `live` up to freshMin · `stale` up to offlineMin · `offline` beyond it — a
 * device that stopped days ago is a different situation from one that skipped
 * a poll, and the UI must not present the two the same way.
 */
export const DATA_AGE = {
  freshMin: 3,
  staleMin: 15,
  offlineMin: 60,
  /** Re-render cadence of the age label */
  tickMs: 10000,
};

/** Toast behaviour: how long a message stays, and how many stack at once. */
export const TOASTS = { ttlMs: 4000, max: 3 };

/**
 * How long the air-quality card shows one particulate channel before sliding to
 * the next. Long enough to read a number and its status without feeling chased;
 * the card pauses on hover/focus and stops entirely under reduced-motion.
 */
export const AIR_ROTATE_MS = 6000;

/**
 * Client-side deadline for the dashboard/health polls.
 * Without one, an API base that accepts the connection and then never answers
 * leaves the in-flight guard set forever and the poll loop stops for good —
 * silently, with the last good reading still on screen.
 */
export const API_TIMEOUT_MS = 15000;

/**
 * Global keyboard shortcuts, single keys only (no modifiers) so they stay
 * memorable; `keys` are matched case-insensitively and ignored while typing.
 * `key` is the i18n suffix under `shortcuts.*` for the help sheet.
 */
export const SHORTCUTS = [
  { id: 'tab1', keys: ['1'], key: 'tab1' },
  { id: 'tab2', keys: ['2'], key: 'tab2' },
  { id: 'tab3', keys: ['3'], key: 'tab3' },
  { id: 'refresh', keys: ['r'], key: 'refresh' },
  { id: 'ai', keys: ['/'], key: 'ai' },
  { id: 'settings', keys: ['s'], key: 'settings' },
  { id: 'theme', keys: ['t'], key: 'theme' },
  { id: 'help', keys: ['?'], key: 'help' },
  { id: 'close', keys: ['Escape'], key: 'close' },
];

/**
 * Where the desktop layout starts. Must stay in step with the 1024px media
 * queries in app/globals.css (sidebar rail, docked assistant): above it the
 * assistant behaves like a window, below it it stays a popover over the button.
 */
export const DESKTOP_MIN_WIDTH = 1024;

/**
 * The assistant window on desktop: docked to the right edge by default, dragged
 * out into a floating window, snapped back by dropping it near that edge.
 * Sizes in px; the dock width and the floating rect are both user-adjustable and
 * remembered in STORAGE.aiWindow.
 */
export const AI_WINDOW = {
  dockWidth: 400,
  minWidth: 320,
  /** Keeps the dashboard readable no matter how wide the panel is dragged. */
  maxWidthRatio: 0.55,
  floatWidth: 420,
  floatHeight: 560,
  minHeight: 320,
  /** How close to the right edge a drop counts as "snap back to docked". */
  snapZone: 72,
  /** Movement before a press on the title bar counts as a drag, not a click. */
  dragThreshold: 4,
  /**
   * Content width below which the nav rail collapses to a hover strip. A wide
   * assistant plus a 15rem rail leaves the dashboard too narrow to read, and the
   * rail is the part you need least while you are talking to the assistant.
   */
  railPeekUnder: 1000,
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
  aiSummaryPollMs: 1800000,
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

/**
 * Validated chart palette (series hexes unchanged; chrome matches the soft surfaces).
 * The three PM series take violet/orange/pink slots from ID_SERIES_PALETTE below,
 * so they stay separable from each other and from temp/hum under CVD.
 */
export const CHART_COLORS = {
  light: {
    temp: '#e34948',
    hum: '#2a78d6',
    pm1: '#e87ba4',
    pm25: '#4a3aa7',
    pm10: '#eb6834',
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
    pm1: '#d55181',
    pm25: '#9085e9',
    pm10: '#d95926',
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
