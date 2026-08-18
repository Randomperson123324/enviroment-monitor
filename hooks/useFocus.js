'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  STORAGE,
  CLIENT_FALLBACK,
  FOCUS_THRESHOLD_INPUT,
  FOCUS_MODES,
  FOCUS_MODE_DEFAULT,
} from '@/config/client';

/** Normalize movement whether stored as a number or an object of counts. */
export function movementCount(m) {
  if (typeof m === 'number') return m;
  if (m && typeof m === 'object') {
    return Object.values(m).reduce((a, v) => a + (Number(v) || 0), 0);
  }
  return Number(m) || 0;
}

/** Group chronological rows into fixed-width time buckets. */
function bucketize(rows, bucketMs) {
  const map = new Map();
  for (const r of rows) {
    const t = Date.parse(r.created_at);
    if (!Number.isFinite(t)) continue;
    const key = Math.floor(t / bucketMs) * bucketMs;
    if (!map.has(key)) {
      map.set(key, { ts: key, movement: 0, face_count: 0, count: 0, direction: null, person: null });
    }
    const b = map.get(key);
    b.movement += movementCount(r.movement);
    b.face_count = Math.max(b.face_count, r.face_count ?? 0);
    b.count++;
    if (r.direction) b.direction = r.direction;
    if (r.person != null) b.person = r.person;
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Focus monitor data: Supabase REST history + Realtime inserts.
 * All endpoints/keys come from server config (GET /api/config) — nothing hardcoded.
 */
export default function useFocus({ focusCfg, addLog }) {
  const [rows, setRows] = useState([]);
  const [threshold, setThresholdState] = useState(null);
  const [mode, setModeState] = useState(FOCUS_MODE_DEFAULT);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const stopped = useRef(false);

  useEffect(() => {
    const saved = Number(localStorage.getItem(STORAGE.focusThreshold));
    if (Number.isFinite(saved) && saved > 0) setThresholdState(saved);
    const savedMode = localStorage.getItem(STORAGE.focusMode);
    if (FOCUS_MODES.some((m) => m.id === savedMode)) setModeState(savedMode);
  }, []);

  const effectiveThreshold =
    threshold ?? focusCfg?.thresholdDefault ?? CLIENT_FALLBACK.focus.thresholdDefault;

  const setThreshold = useCallback((v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    // Input min/max are advisory only — typed values must be clamped here too.
    const clamped = Math.min(FOCUS_THRESHOLD_INPUT.max, Math.max(FOCUS_THRESHOLD_INPUT.min, n));
    setThresholdState(clamped);
    localStorage.setItem(STORAGE.focusThreshold, String(clamped));
  }, []);

  const setMode = useCallback((id) => {
    if (!FOCUS_MODES.some((m) => m.id === id)) return;
    setModeState(id);
    localStorage.setItem(STORAGE.focusMode, id);
  }, []);

  const mergeRows = useCallback((incoming, keepLimit) => {
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      const added = incoming.filter((r) => r?.id != null && !seen.has(r.id));
      if (!added.length) return prev;
      const next = [...added, ...prev].sort(
        (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
      );
      if (next.length > keepLimit) next.length = keepLimit;
      return next;
    });
  }, []);

  // History poll via Supabase REST.
  useEffect(() => {
    if (!focusCfg?.supabaseUrl || !focusCfg?.supabaseAnonKey) return undefined;
    let alive = true;

    const fetchHistory = async () => {
      try {
        const url =
          `${focusCfg.supabaseUrl}/rest/v1/${focusCfg.table}` +
          `?select=*&order=created_at.desc&limit=${focusCfg.fetchLimit}`;
        const r = await fetch(url, {
          headers: {
            apikey: focusCfg.supabaseAnonKey,
            Authorization: `Bearer ${focusCfg.supabaseAnonKey}`,
          },
          cache: 'no-store',
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (alive) mergeRows(data, focusCfg.fetchLimit * 2);
      } catch (e) {
        if (alive) addLog(`[กล้อง] โหลดข้อมูลไม่สำเร็จ: ${e.message}`, 'err');
      }
    };

    fetchHistory();
    const timer = setInterval(fetchHistory, focusCfg.pollMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [focusCfg, addLog, mergeRows]);

  // Realtime inserts via Supabase websocket (Phoenix protocol).
  useEffect(() => {
    if (!focusCfg?.supabaseUrl || !focusCfg?.supabaseAnonKey) return undefined;
    stopped.current = false;

    const connect = () => {
      if (stopped.current) return;
      const wsBase = focusCfg.supabaseUrl.replace(/^http/, 'ws');
      const ws = new WebSocket(
        `${wsBase}/realtime/v1/websocket?apikey=${focusCfg.supabaseAnonKey}&vsn=1.0.0`
      );
      let heartbeat = null;
      wsRef.current = ws;

      ws.onopen = () => {
        addLog('[กล้อง] เชื่อมต่อแบบเรียลไทม์แล้ว', 'ok');
        setConnected(true);
        ws.send(
          JSON.stringify({
            topic: `realtime:public:${focusCfg.table}`,
            event: 'phx_join',
            payload: {
              config: {
                broadcast: { self: false },
                presence: { key: '' },
                postgres_changes: [{ event: 'INSERT', schema: 'public', table: focusCfg.table }],
              },
            },
            ref: '1',
          })
        );
        heartbeat = setInterval(() => {
          // A closing socket throws on send — let onclose handle the retry.
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: null }));
        }, focusCfg.realtimeHeartbeatMs);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const record = msg.payload?.data?.record ?? msg.payload?.record;
          if ((msg.event === 'postgres_changes' || msg.payload?.data?.type === 'INSERT') && record?.id) {
            mergeRows([record], focusCfg.fetchLimit * 2);
            // ชื่อมาจากแกลเลอรีรูปบน Pi — ไม่มีชื่อก็ยังมีหมายเลข track เหมือนเดิม
            const who = record.name ? `${record.name} (#${record.person})` : `บุคคลที่ ${record.person}`;
            addLog(`[กล้อง] ${who} ขยับ ${movementCount(record.movement)} ครั้ง`, 'ok');
          }
        } catch {
          /* non-JSON frames are expected noise */
        }
      };

      ws.onerror = () => addLog('[กล้อง] การเชื่อมต่อเรียลไทม์ขัดข้อง', 'warn');
      ws.onclose = () => {
        clearInterval(heartbeat);
        setConnected(false);
        if (!stopped.current) {
          addLog(`[กล้อง] หลุดการเชื่อมต่อ — ลองใหม่ใน ${focusCfg.realtimeRetryMs / 1000} วินาที`, 'warn');
          setTimeout(connect, focusCfg.realtimeRetryMs);
        }
      };
    };

    connect();
    return () => {
      stopped.current = true;
      wsRef.current?.close();
    };
  }, [focusCfg, addLog, mergeRows]);

  const buckets = useMemo(() => {
    if (!focusCfg) return [];
    const chrono = [...rows].reverse();
    return bucketize(chrono, focusCfg.bucketMs);
  }, [rows, focusCfg]);

  return {
    rows,
    buckets,
    latest: rows[0] ?? null,
    threshold: effectiveThreshold,
    setThreshold,
    mode,
    setMode,
    connected,
  };
}
