'use client';

import { useState } from 'react';
import { ScrollText, Check, Info, TriangleAlert, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useLang } from '@/hooks/useLang';

const LEVEL_ICON = {
  ok: Check,
  info: Info,
  warn: TriangleAlert,
  err: X,
};

/**
 * System log — diagnostics, so it stays collapsed by default and shows the
 * latest entry as a one-line preview instead of claiming a full panel.
 */
export default function LogPanel({ logs, onClear, onRefresh }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  return (
    <div className="panel log-panel">
      <div className="subhdr">
        <button
          className="log-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={open ? t('log.collapse') : t('log.expand')}
        >
          <span className="panel-title ai-float-title">
            <ScrollText size={16} strokeWidth={2.2} aria-hidden /> {t('log.title')}
            <span className="log-count">{logs.length}</span>
          </span>
          {!open && logs[0] && <span className="log-preview">{logs[0].msg}</span>}
          {open ? (
            <ChevronUp size={16} strokeWidth={2.2} aria-hidden />
          ) : (
            <ChevronDown size={16} strokeWidth={2.2} aria-hidden />
          )}
        </button>
        {open && (
          <div className="subhdr-actions">
            <button className="mini-btn" onClick={onClear}>
              {t('log.clear')}
            </button>
            <button className="mini-btn" onClick={onRefresh}>
              {t('log.refresh')}
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="log-body">
          {logs.map((row) => {
            const Icon = LEVEL_ICON[row.lv];
            return (
              <div key={row.id} className="log-row">
                <span className="log-ts">
                  {row.ts.toLocaleTimeString('th-TH', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                <span className={`log-lv ${row.lv}`}>
                  {Icon ? <Icon size={13} strokeWidth={2.6} aria-hidden /> : null}
                </span>
                <span className="log-msg">{row.msg}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
