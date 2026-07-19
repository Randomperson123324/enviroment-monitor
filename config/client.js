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
  pollMs: 'em_poll_ms',
  deviceId: 'em_device_id',
  chartHours: 'em_chart_hours',
  chartSmooth: 'em_chart_smooth',
  focusThreshold: 'em_focus_threshold',
  activeTab: 'em_active_tab',
};

/** Dashboard sections, grouped by the top-level menu. */
export const TABS = [
  { id: 'environment', label: 'Environment' },
  { id: 'focus', label: 'Focus' },
  { id: 'hydro', label: 'Hydro Info' },
];

export const CHART_RANGES = [
  { h: 1, label: '1 ชม.' },
  { h: 6, label: '6 ชม.' },
  { h: 12, label: '12 ชม.' },
  { h: 24, label: '24 ชม.' },
  { h: 72, label: '3 วัน' },
];

export const SMOOTH_OPTIONS = [
  { value: 1, label: 'ดิบ' },
  { value: 3, label: 'เบา' },
  { value: 5, label: 'กลาง' },
  { value: 9, label: 'ลื่น' },
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

/** Fallbacks if GET /api/config is unreachable (server values win). */
export const CLIENT_FALLBACK = {
  pollMsDefault: 5000,
  pollMsMin: 3000,
  pollMsMax: 60000,
  healthPollMs: 30000,
  floodRefreshMs: 60000,
  govRefreshMs: 300000,
  geminiEnabled: false,
  focus: null,
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

/** Status palette (fixed, never themed). */
export const STATUS_COLORS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

/** Hex → rgba with alpha (for chart fills). */
export function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
