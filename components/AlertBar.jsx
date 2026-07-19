'use client';

import { THRESHOLDS } from '@/config/sensors';
import { MSG, fill } from '@/config/messages.th';

/** Gas alert banner + upstream data-quality warnings. */
export default function AlertBar({ latest }) {
  if (!latest) return null;
  const gas = Number(latest.gas_ppm ?? 0);
  const t = THRESHOLDS.gas;

  if (gas > t.danger) {
    const template = gas > t.critical ? MSG.alerts.gasCritical : MSG.alerts.gasHigh;
    return (
      <div className="alert-bar" role="alert">
        <span>⚠</span>
        <span>{fill(template, { v: gas.toFixed(0) })}</span>
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
