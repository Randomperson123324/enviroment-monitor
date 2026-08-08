'use client';

import { THRESHOLDS } from '@/config/sensors';
import { useLang } from '@/hooks/useLang';

/** Gas alert banner + upstream data-quality warnings. */
export default function AlertBar({ latest }) {
  const { t } = useLang();
  if (!latest) return null;
  const gas = Number(latest.gas_ppm ?? 0);
  const th = THRESHOLDS.gas;

  if (gas > th.danger) {
    const key = gas > th.critical ? 'alert.gasCritical' : 'alert.gasHigh';
    return (
      <div className="alert-bar" role="alert">
        <span>⚠</span>
        <span>{t(key, { v: gas.toFixed(0) })}</span>
      </div>
    );
  }

  const warnings = latest._data_warnings ?? [];
  if (warnings.length) {
    return (
      <div className="alert-bar" role="alert">
        <span>⚠</span>
        <span>{warnings[0]}</span>
      </div>
    );
  }
  return null;
}
