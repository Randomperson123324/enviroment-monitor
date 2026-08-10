'use client';

import { Keyboard, X } from 'lucide-react';
import { SHORTCUTS } from '@/config/client';
import { useLang } from '@/hooks/useLang';

/** Escape is handled by the global shortcut hook, so this only draws. */
export default function ShortcutHelp({ onClose }) {
  const { t } = useLang();

  return (
    <div className="modal-ov" onClick={onClose}>
      <div
        className="modal keys-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="keys-head">
          <h3 className="ai-float-title">
            <Keyboard size={18} strokeWidth={2.2} aria-hidden /> {t('shortcuts.title')}
          </h3>
          <button className="icon-btn" onClick={onClose} aria-label={t('ai.close')}>
            <X size={16} strokeWidth={2.4} aria-hidden />
          </button>
        </div>
        <p className="field-hint">{t('shortcuts.meta')}</p>

        <ul className="keys-list">
          {SHORTCUTS.map((s) => (
            <li key={s.id}>
              <span className="keys-combo">
                {s.keys.map((k) => (
                  <kbd key={k}>{k === 'Escape' ? 'Esc' : k}</kbd>
                ))}
              </span>
              <span className="keys-desc">{t(`shortcuts.${s.key}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
