'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TOASTS } from '@/config/client';

/**
 * Transient confirmations for actions the user just took.
 *
 * The dashboard had no acknowledgement at all: pressing refresh or saving
 * settings only appended a line to the system log, which is collapsed and far
 * from the button that was pressed. `notify(text, level)` puts the answer next
 * to the action instead. The system log stays as the durable record — a toast
 * is not a log line, it disappears.
 */
export default function useToasts() {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((x) => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (text, level = 'ok') => {
      if (!text) return;
      const id = ++seq.current;
      // Newest last, oldest dropped: a burst of polls must not build a wall.
      setToasts((list) => [...list, { id, text, level }].slice(-TOASTS.max));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOASTS.ttlMs)
      );
    },
    [dismiss]
  );

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return { toasts, notify, dismiss };
}
