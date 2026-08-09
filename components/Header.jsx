'use client';

import { useEffect, useState } from 'react';
import { House, RotateCw, Settings, Sun, Moon, Menu, X, Languages } from 'lucide-react';
import { DATA_AGE } from '@/config/client';
import TabMenu from '@/components/TabMenu';
import { useLang } from '@/hooks/useLang';

function DataAge({ createdAt }) {
  const { t } = useLang();
  const [, force] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => force((n) => n + 1), DATA_AGE.tickMs);
    return () => clearInterval(timer);
  }, []);
  if (!createdAt) return null;
  const mins = Math.round((Date.now() - Date.parse(createdAt)) / 60000);
  if (!Number.isFinite(mins)) return null;
  const color =
    mins <= DATA_AGE.freshMin ? 'var(--lv-ok)' : mins <= DATA_AGE.staleMin ? 'var(--lv-warning)' : 'var(--lv-danger)';
  return (
    <span className="data-age" style={{ color }}>
      {mins <= 1 ? t('header.agoJustNow') : t('header.agoMinutes', { n: mins })}
    </span>
  );
}

export default function Header({
  theme,
  onToggleTheme,
  devices,
  deviceId,
  onSelectDevice,
  latest,
  onRefresh,
  onOpenSettings,
  activeTab,
  onSelectTab,
}) {
  const { t, toggle: toggleLang } = useLang();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={`hdr ${menuOpen ? 'open' : ''}`}>
      <div className="brand">
        <div className="brand-mark">
          <House size={21} strokeWidth={2} aria-hidden />
        </div>
        <div>
          <div className="brand-name">ENV Monitor</div>
          <div className="brand-sub">{t('header.brandSub')}</div>
        </div>
      </div>

      <button
        className="icon-btn hdr-burger"
        onClick={() => setMenuOpen((o) => !o)}
        aria-label={t('header.menu')}
        aria-expanded={menuOpen}
        title={t('header.menu')}
      >
        {menuOpen ? (
          <X size={19} strokeWidth={2.2} aria-hidden />
        ) : (
          <Menu size={19} strokeWidth={2.2} aria-hidden />
        )}
      </button>

      <div className="hdr-collapse">
        {/* Mobile only (hidden by CSS on desktop, where the nav has its own bar).
            Picking a section also closes the panel — leaving it open would cover
            the content the tap just navigated to. */}
        <TabMenu
          active={activeTab}
          onSelect={(id) => {
            onSelectTab(id);
            setMenuOpen(false);
          }}
          className="in-hdr"
        />

        <div className="hdr-mid">
          <div className="dev-select">
            <span>{t('header.device')}</span>
            <select
              value={deviceId ?? ''}
              onChange={(e) => onSelectDevice(e.target.value)}
              disabled={!devices.length}
              aria-label={t('header.selectDevice')}
            >
              {devices.length ? (
                devices.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))
              ) : (
                <option value="">{t('header.noData')}</option>
              )}
            </select>
          </div>
          <DataAge createdAt={latest?.created_at} />
        </div>

        <div className="hdr-right">
          <button
            className="icon-btn lang-btn"
            onClick={toggleLang}
            title={t('lang.label')}
            aria-label={t('lang.label')}
          >
            <Languages size={16} strokeWidth={2.2} aria-hidden />
            <span className="lang-code">{t('lang.toggle')}</span>
          </button>
          <button className="icon-btn" onClick={onRefresh} title={t('header.refresh')}>
            <RotateCw size={17} strokeWidth={2.2} aria-hidden />
          </button>
          <button className="icon-btn" onClick={onOpenSettings} title={t('header.settings')}>
            <Settings size={17} strokeWidth={2.2} aria-hidden />
          </button>
          <button className="icon-btn" onClick={onToggleTheme} title={t('header.toggleTheme')}>
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
