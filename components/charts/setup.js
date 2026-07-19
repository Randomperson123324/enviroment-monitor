'use client';

/** One-time Chart.js registration for every chart in the app. */
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Filler,
  Legend,
  Tooltip,
} from 'chart.js';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Filler,
  Legend,
  Tooltip
);

// Canvas cannot resolve CSS variables, and next/font registers the face under
// a hashed family name — so read the real family off <body> at load time.
if (typeof document !== 'undefined' && document.body) {
  const family = getComputedStyle(document.body).fontFamily;
  if (family) Chart.defaults.font.family = family;
}
Chart.defaults.font.size = 11;

// Live dashboard redraws every poll — no tween animations (also avoids the
// Animator ticking charts that React has already unmounted).
Chart.defaults.animation = false;
Chart.defaults.plugins.tooltip.animation = false;
