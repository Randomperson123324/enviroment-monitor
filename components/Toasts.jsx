'use client';

import { Check, TriangleAlert, Info, X } from 'lucide-react';
import { useLang } from '@/hooks/useLang';

const ICONS = { ok: Check, err: TriangleAlert, info: Info };

/**
 * Toast stack, bottom-centre so it never sits under the AI button.
 * One live region for the whole stack: announcing each toast as its own region
 * makes a screen reader restart mid-sentence when two arrive together.
 */
export default function Toasts({ toasts, onDismiss }) {
  const { t } = useLang();
  if (!toasts.length) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.level] ?? Info;
        return (
          <div key={toast.id} className={`toast ${toast.level}`}>
            <Icon size={15} strokeWidth={2.4} aria-hidden />
            <span className="toast-text">{toast.text}</span>
            <button
              className="toast-x"
              onClick={() => onDismiss(toast.id)}
              aria-label={t('toast.dismiss')}
            >
              <X size={13} strokeWidth={2.4} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
