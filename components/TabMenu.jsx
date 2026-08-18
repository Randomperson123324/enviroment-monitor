'use client';

import { Leaf, Eye, HeartPulse } from 'lucide-react';
import { TABS } from '@/config/client';
import { useLang } from '@/hooks/useLang';

const TAB_ICONS = { environment: Leaf, focus: Eye, health: HeartPulse };

/**
 * Section navigation. Rendered twice — as its own bar below the header on
 * desktop (`standalone`) and inside the header's burger panel on mobile
 * (`in-hdr`) — with CSS showing exactly one at a time. Keeping it in one
 * component means the two placements can never drift apart; `display: none`
 * also drops the hidden copy out of the accessibility tree, so there is only
 * ever one set of tab buttons to tab through.
 */
export default function TabMenu({ active, onSelect, className = '' }) {
  const { t } = useLang();

  return (
    <nav className={`tab-menu ${className}`} aria-label={t('tabs.menuLabel')}>
      {TABS.map((tab) => {
        const Icon = TAB_ICONS[tab.id];
        return (
          <button
            key={tab.id}
            className={`tab-item ${active === tab.id ? 'active' : ''}`}
            onClick={() => onSelect(tab.id)}
            aria-current={active === tab.id ? 'page' : undefined}
          >
            <Icon size={17} strokeWidth={2.2} aria-hidden />
            <span>{t(`tabs.${tab.id}`)}</span>
          </button>
        );
      })}
    </nav>
  );
}
