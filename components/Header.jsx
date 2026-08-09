'use client';

import { useState } from 'react';
import { House, RotateCw, Settings, Sun, Moon, Menu, X, Languages } from 'lucide-react';
import TabMenu from '@/components/TabMenu';
import DeviceSelect from '@/components/DeviceSelect';
import DataAge from '@/components/DataAge';
import { useLang } from '@/hooks/useLang';

/** Top bar for narrow viewports; from 1024px up the Sidebar replaces it. */
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
          <DeviceSelect devices={devices} deviceId={deviceId} onSelectDevice={onSelectDevice} />
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
