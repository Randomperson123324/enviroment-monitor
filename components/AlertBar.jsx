'use client';

import { Siren, TriangleAlert } from 'lucide-react';
import { THRESHOLDS } from '@/config/sensors';
import { useLang } from '@/hooks/useLang';

/**
 * The one banner for "act now", driven by PM2.5 — the only measured value here
 * with a health standard behind it. (It used to fire on the MQ-2's ppm, which
 * could not distinguish cooking from a leak.) Upstream data-quality warnings
 * take the same slot when nothing is dangerous.
 */
export default function AlertBar({ latest }) {
  const { t } = useLang();
  if (!latest) return null;

  const pm25 = latest.pm25 != null ? Number(latest.pm25) : null;
  const th = THRESHOLDS.pm25;

  if (pm25 != null && Number.isFinite(pm25) && pm25 > th.danger) {
    const critical = pm25 > th.critical;
    const Icon = critical ? Siren : TriangleAlert;
    return (
      <div className={`alert-bar ${critical ? 'critical' : ''}`} role="alert">
        <Icon size={16} strokeWidth={2.4} aria-hidden />
        <span>{t(critical ? 'alert.pmCritical' : 'alert.pmHigh', { v: pm25.toFixed(0) })}</span>
      </div>
    );
  }

  const warnings = latest._data_warnings ?? [];
  if (warnings.length) {
    return (
      <div className="alert-bar" role="alert">
        <TriangleAlert size={16} strokeWidth={2.4} aria-hidden />
        <span>{warnings[0]}</span>
      </div>
    );
  }
  return null;
}
