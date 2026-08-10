'use client';

import { useState } from 'react';
import { House, RotateCw, Settings, Sun, Moon, Menu, X, Languages, Keyboard } from 'lucide-react';
import TabMenu from '@/components/TabMenu';
import DeviceSelect from '@/components/DeviceSelect';
import { StatusPill } from '@/components/DataStatus';
import { useLang } from '@/hooks/useLang';

/**
 * The one sticky bar that carries *state and actions* at every width: which
 * device, how fresh its data is, and the controls that act on it.
 *
 * It used to be mobile-only, with the desktop sidebar carrying a second copy of
 * the device picker and every button. Two homes for the same controls meant the
 * freshness of the data was easy to miss and each control had to be found in a
 * different place depending on the window size. Now the sidebar navigates and
 * this bar operates; on desktop the brand block hides here because the rail
 * already shows it.
 */
export default function Header({
  theme,
  onToggleTheme,
  devices,
  deviceId,
  onSelectDevice,
  status,
  onRefresh,
  onOpenSettings,
  onOpenHelp,
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
        <div className="brand-text">
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
        {/* Mobile only (hidden by CSS wherever a nav rail or tab strip shows).
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
          <StatusPill status={status} />
        </div>

        <div className="hdr-right">
          <button className="icon-btn" onClick={onRefresh} title={`${t('header.refresh')} (R)`}>
            <RotateCw size={17} strokeWidth={2.2} aria-hidden />
          </button>
          <button className="icon-btn" onClick={onOpenHelp} title={`${t('header.help')} (?)`}>
            <Keyboard size={17} strokeWidth={2.2} aria-hidden />
          </button>
          <button className="icon-btn" onClick={onOpenSettings} title={`${t('header.settings')} (S)`}>
            <Settings size={17} strokeWidth={2.2} aria-hidden />
          </button>
          <button className="icon-btn" onClick={onToggleTheme} title={`${t('header.toggleTheme')} (T)`}>
            {theme === 'dark' ? (
              <Sun size={17} strokeWidth={2.2} aria-hidden />
            ) : (
              <Moon size={17} strokeWidth={2.2} aria-hidden />
            )}
          </button>
          <button className="icon-btn lang-btn" onClick={toggleLang} title={t('lang.label')}>
            <Languages size={16} strokeWidth={2.2} aria-hidden />
            <span className="lang-code">{t('lang.toggle')}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
