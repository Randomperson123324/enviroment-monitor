'use client';

import { useEffect, useState } from 'react';
import { House, RotateCw, Settings, Sun, Moon, Menu, X } from 'lucide-react';
import { DATA_AGE } from '@/config/client';

function DataAge({ createdAt }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), DATA_AGE.tickMs);
    return () => clearInterval(t);
  }, []);
  if (!createdAt) return null;
  const mins = Math.round((Date.now() - Date.parse(createdAt)) / 60000);
  if (!Number.isFinite(mins)) return null;
  const color =
    mins <= DATA_AGE.freshMin ? 'var(--lv-ok)' : mins <= DATA_AGE.staleMin ? 'var(--lv-warning)' : 'var(--lv-danger)';
  return (
    <span className="data-age" style={{ color }}>
      {mins <= 1 ? '● เมื่อสักครู่' : `● ${mins} นาทีที่แล้ว`}
    </span>
  );
}

function Clock() {
  const [now, setNow] = useState(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="clock">
      {now
        ? now.toLocaleTimeString('th-TH', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '--:--:--'}
    </div>
  );
}

export default function Header({
  theme,
  onToggleTheme,
  devices,
  deviceId,
  onSelectDevice,
  latest,
  health,
  onRefresh,
  onOpenSettings,
}) {
  const dbState =
    health.supabaseOk == null ? '' : health.supabaseOk ? 'live' : 'err';
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={`hdr ${menuOpen ? 'open' : ''}`}>
      <div className="brand">
        <div className="brand-mark">
          <House size={21} strokeWidth={2} aria-hidden />
        </div>
        <div>
          <div className="brand-name">ENV Monitor</div>
          <div className="brand-sub">ดูแลสภาพแวดล้อมห้องของคุณ</div>
        </div>
      </div>

      <button
        className="icon-btn hdr-burger"
        onClick={() => setMenuOpen((o) => !o)}
        aria-label="เมนู"
        aria-expanded={menuOpen}
        title="เมนู"
      >
        {menuOpen ? (
          <X size={19} strokeWidth={2.2} aria-hidden />
        ) : (
          <Menu size={19} strokeWidth={2.2} aria-hidden />
        )}
      </button>

      <div className="hdr-collapse">
        <div className="hdr-mid">
          <div className="dev-select">
            <span>อุปกรณ์</span>
            <select
              value={deviceId ?? ''}
              onChange={(e) => onSelectDevice(e.target.value)}
              disabled={!devices.length}
              aria-label="เลือกอุปกรณ์"
            >
              {devices.length ? (
                devices.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))
              ) : (
                <option value="">— รอข้อมูล —</option>
              )}
            </select>
          </div>
          <DataAge createdAt={latest?.created_at} />
        </div>

        <div className="hdr-right">
          <div className={`pill ${dbState}`}>
            <span className="dot" />
            <span>{health.supabaseOk === false ? 'ขาดการเชื่อมต่อ' : 'เชื่อมต่อแล้ว'}</span>
          </div>
          <Clock />
          <button className="icon-btn" onClick={onRefresh} title="รีเฟรชข้อมูล">
            <RotateCw size={17} strokeWidth={2.2} aria-hidden />
          </button>
          <button className="icon-btn" onClick={onOpenSettings} title="ตั้งค่า">
            <Settings size={17} strokeWidth={2.2} aria-hidden />
          </button>
          <button className="icon-btn" onClick={onToggleTheme} title="สลับโหมดสว่าง/มืด">
            {theme === 'dark' ? (
              <Sun size={17} strokeWidth={2.2} aria-hidden />
            ) : (
              <Moon size={17} strokeWidth={2.2} aria-hidden />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
