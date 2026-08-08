/**
 * Evaluate a reading against the environmental disease rules.
 * Returns active risks (highest severity first) plus a summary.
 */
import { DISEASES } from '@/config/diseases';

const LEVEL_RANK = { danger: 2, warning: 1, '': 0 };

export function assessDiseases(reading) {
  if (!reading) return { risks: [], worst: null, allClear: false };

  const risks = DISEASES.map((d) => {
    const reason = d.reason(reading);
    return {
      id: d.id,
      nameKey: d.nameKey,
      level: d.level(reading) || '',
      reasonKey: reason.key,
      reasonVars: reason.vars,
      preventionKey: d.preventionKey,
      source: d.source,
    };
  })
    .filter((d) => d.level)
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);

  const worst = risks.some((r) => r.level === 'danger')
    ? 'danger'
    : risks.length
      ? 'warning'
      : null;

  return { risks, worst, allClear: reading != null && risks.length === 0 };
}
