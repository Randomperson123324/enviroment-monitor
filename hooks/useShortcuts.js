'use client';

import { useEffect } from 'react';

/** A keystroke aimed at a text field belongs to that field, not to the app. */
function isTyping(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Single-key global shortcuts (see SHORTCUTS in config/client.js).
 *
 * No modifiers on purpose — the point is that they are reachable one-handed
 * while watching the room. Any keystroke with Ctrl/Alt/Meta is left to the
 * browser so we never shadow Ctrl+R, and typing in a field always wins.
 *
 * `handlers` maps shortcut id → function; ids without a handler do nothing.
 */
export default function useShortcuts(handlers) {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;

      const key = e.key;
      // "?" is Shift+/ on most layouts. Real keyboards report the shifted glyph,
      // but synthetic events (and some layouts) deliver "/" with shiftKey set —
      // accept both so the documented "?" always opens the help sheet.
      const isHelp = key === '?' || (key === '/' && e.shiftKey);
      const id =
        key === 'Escape'
          ? 'close'
          : isHelp
            ? 'help'
            : key === '/'
              ? 'ai'
              : e.shiftKey
                ? null
                : { 1: 'tab1', 2: 'tab2', 3: 'tab3', r: 'refresh', s: 'settings', t: 'theme' }[
                    key.toLowerCase()
                  ];

      const handler = id && handlers[id];
      if (!handler) return;
      e.preventDefault();
      handler();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
