'use client';

import { House, RotateCw, Settings, Sun, Moon, Languages } from 'lucide-react';
import TabMenu from '@/components/TabMenu';
import DeviceSelect from '@/components/DeviceSelect';
import DataAge from '@/components/DataAge';
import { useLang } from '@/hooks/useLang';

/**
 * Desktop navigation rail, following StreeFlood's `<aside data-app-sidebar>`:
 * a fixed floating glass column — brand, divider, nav taking the free space,
 * divider, controls pinned to the bottom.
 *
 * Shown from 1024px up (StreeFlood's `lg`), where the top bar hides instead.
 * Below that the top bar and its burger panel take over, so the two never
 * appear together.
 */
export default function Sidebar({
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

  return (
    <aside className="sidebar" aria-label={t('tabs.menuLabel')}>
      <div className="panel sidebar-inner">
        <div className="brand">
          <div className="brand-mark">
            <House size={21} strokeWidth={2} aria-hidden />
          </div>
          <div className="brand-text">
            <div className="brand-name">ENV Monitor</div>
            <div className="brand-sub">{t('header.brandSub')}</div>
          </div>
        </div>

        <div className="sidebar-div" />

        <div className="sidebar-device">
          <DeviceSelect devices={devices} deviceId={deviceId} onSelectDevice={onSelectDevice} />
          <DataAge createdAt={latest?.created_at} />
        </div>

        <div className="sidebar-div" />

        {/* flex-1 here is what pushes the controls below to the bottom edge. */}
        <TabMenu active={activeTab} onSelect={onSelectTab} className="in-side" />

        <div className="sidebar-div" />

        <div className="sidebar-actions">
          <button className="icon-btn lang-btn" onClick={toggleLang} title={t('lang.label')}>
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
    </aside>
  );
}
