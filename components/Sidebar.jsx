'use client';

import { useEffect, useState } from 'react';
import { Bot, House } from 'lucide-react';
import TabMenu from '@/components/TabMenu';
import { useLang } from '@/hooks/useLang';

/**
 * Desktop navigation rail, following StreeFlood's `<aside data-app-sidebar>`:
 * a fixed floating glass column — brand, divider, then the section nav.
 *
 * Navigation only. The device picker, freshness and action buttons used to be
 * duplicated down here as well; they now live in the sticky top bar, which is
 * present at every width, so each control has exactly one home.
 *
 * Shown from 1024px up (StreeFlood's `lg`); below that the top bar's burger
 * panel carries the same nav.
 */
export default function Sidebar({ activeTab, onSelectTab }) {
  const { t } = useLang();
  /**
   * The panel owns whether it is open; the rail only mirrors it, the same way a
   * tab row mirrors the section on screen. Both directions travel as events, so
   * neither component has to hold the other's state — the "/" shortcut already
   * opens the assistant this way.
   */
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    const onState = (e) => setAiOpen(Boolean(e.detail?.open));
    window.addEventListener('env-monitor:ai-state', onState);
    return () => window.removeEventListener('env-monitor:ai-state', onState);
  }, []);

  return (
    <>
      {/*
        Screen-edge hover target, active only while the rail is folded away (CSS
        gates it on data-rail-peek). It is a sibling, not a child: inside the
        rail it would travel with the rail's transform and stop covering the edge
        exactly when it is needed.
      */}
      <div className="rail-edge" aria-hidden />
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

          <TabMenu active={activeTab} onSelect={onSelectTab} className="in-side" />

          {/* The assistant sits at the foot of the rail rather than floating over
              the page. It is not a section, so it is below the nav and separated
              from it — pressing it opens a panel, it does not navigate. The
              floating button stays for narrower screens, where there is no rail
              to put it in. */}
          <div className="sidebar-div" />
          <button
            className={`tab-item sidebar-ai ${aiOpen ? 'active' : ''}`}
            onClick={() => window.dispatchEvent(new CustomEvent('env-monitor:toggle-ai'))}
            title={aiOpen ? t('ai.close') : `${t('ai.openAi')} (/)`}
            aria-expanded={aiOpen}
          >
            <Bot size={17} strokeWidth={2.2} aria-hidden />
            <span>{t('ai.title')}</span>
          </button>

          <div className="sidebar-hint">
            <kbd>?</kbd> {t('shortcuts.hintKey')}
          </div>
        </div>
      </aside>
    </>
  );
}
