'use client';

import { useCallback, useRef, useState } from 'react';
import { LOG_MAX_ROWS } from '@/config/client';

/** In-memory system log shown in the Log panel. */
export default function useLogs() {
  const [logs, setLogs] = useState([]);
  const seq = useRef(0);

  const addLog = useCallback((msg, lv = '') => {
    setLogs((prev) => {
      const row = { id: ++seq.current, ts: new Date(), lv, msg: String(msg) };
      const next = [row, ...prev];
      if (next.length > LOG_MAX_ROWS) next.length = LOG_MAX_ROWS;
      return next;
    });
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  return { logs, addLog, clearLogs };
}
