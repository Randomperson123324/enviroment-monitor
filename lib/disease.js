/**
 * Evaluate a reading against the environmental disease rules.
 * Returns active risks (highest severity first) plus a summary.
 */
import { DISEASES, DISEASE_ALL_CLEAR } from '@/config/diseases';

const LEVEL_RANK = { danger: 2, warning: 1, '': 0 };

export function assessDiseases(reading) {
  if (!reading) return { risks: [], worst: null, allClear: DISEASE_ALL_CLEAR };

  const risks = DISEASES.map((d) => ({
    id: d.id,
    name: d.name,
    level: d.level(reading) || '',
    reason: d.reason(reading),
    prevention: d.prevention,
    source: d.source,
  }))
    .filter((d) => d.level)
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);

  const worst = risks.some((r) => r.level === 'danger')
    ? 'danger'
    : risks.length
      ? 'warning'
      : null;

  return { risks, worst, allClear: risks.length ? null : DISEASE_ALL_CLEAR };
}
