'use client';

import { Radio, Clock, WifiOff, CircleDashed, ServerCrash } from 'lucide-react';
import { useLang } from '@/hooks/useLang';

/**
 * The two ways freshness is surfaced, both driven by useDataStatus():
 *
 *   <StatusPill>   always in the top bar — state + age, never colour alone
 *   <StatusNotice> only when the data is not live — says plainly that the
 *                  numbers below are historical, which the old "connecting to
 *                  Arduino UNO Q" line implied nothing about
 */

const ICONS = { live: Radio, stale: Clock, offline: WifiOff, none: CircleDashed };

export function StatusPill({ status }) {
  const { t } = useLang();
  const Icon = ICONS[status.level] ?? CircleDashed;
  return (
    <span
      className={`status-pill ${status.level}`}
      title={status.atLabel ? t('status.at', { ts: status.atLabel }) : undefined}
    >
      <Icon size={13} strokeWidth={2.4} aria-hidden />
      <span>{status.label}</span>
    </span>
  );
}

/**
 * `api` is `{ ok, error, base }`. An unreachable API outranks staleness: when
 * polling itself is failing, the age of the last reading says nothing about the
 * room — and the reading on screen can sit there looking current for hours.
 */
export function StatusNotice({ status, api }) {
  const { t } = useLang();

  if (api && api.ok === false) {
    return (
      <div className="status-notice offline" role="alert" aria-live="assertive">
        <ServerCrash size={15} strokeWidth={2.2} aria-hidden />
        <span>
          {t('status.apiDown', {
            base: api.base || t('status.apiSameOrigin'),
            msg: api.error || '',
          })}
        </span>
      </div>
    );
  }

  if (status.level === 'live') return null;

  const text =
    status.level === 'none'
      ? t('status.noneBanner')
      : t(status.level === 'offline' ? 'status.offlineBanner' : 'status.staleBanner', {
          ts: status.atLabel,
          age: status.ageLabel,
        });

  // polite, not assertive: it is context for what is on screen, not an alarm
  // that should interrupt whatever a screen reader is currently saying.
  return (
    <div className={`status-notice ${status.level}`} role="status" aria-live="polite">
      <Clock size={15} strokeWidth={2.2} aria-hidden />
      <span>{text}</span>
    </div>
  );
}
