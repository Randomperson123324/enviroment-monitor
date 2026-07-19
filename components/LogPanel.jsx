'use client';

import { ScrollText, Check, Info, TriangleAlert, X } from 'lucide-react';

const LEVEL_ICON = {
  ok: Check,
  info: Info,
  warn: TriangleAlert,
  err: X,
};

export default function LogPanel({ logs, onClear, onRefresh }) {
  return (
    <div className="panel log-panel">
      <div className="subhdr">
        <span className="panel-title ai-float-title">
          <ScrollText size={16} strokeWidth={2.2} aria-hidden /> บันทึกระบบ
        </span>
        <div className="subhdr-actions">
          <button className="mini-btn" onClick={onClear}>
            ล้าง
          </button>
          <button className="mini-btn" onClick={onRefresh}>
            รีเฟรช
          </button>
        </div>
      </div>
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
    </div>
  );
}
