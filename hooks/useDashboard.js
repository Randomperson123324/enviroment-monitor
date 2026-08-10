'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { STORAGE, CHART_VIEW_DEFAULTS } from '@/config/client';
import { SENSORS } from '@/config/sensors';
import { translate } from '@/config/i18n';

/** "อุณหภูมิ 27.4 °C · PM2.5 12 µg/m³" — only the values the device reported. */
function readingLine(row) {
  return SENSORS.filter((s) => row[s.field] != null)
    .map((s) => `${translate('th', `sensor.${s.id}.stat`)} ${Number(row[s.field]).toFixed(s.dp)} ${s.unit}`)
    .join(' · ');
}

/**
 * Dashboard data loop: polls GET /api/dashboard, tracks devices, view
 * range, and DB health. History arrives with every poll, so chart state
 * is always a straight projection of the last payload (no client-side
 * append bookkeeping like v3 had).
 */
export default function useDashboard({ settings, serverCfg, addLog }) {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceIdState] = useState(null);
  const [latest, setLatest] = useState(null);
  const [histRows, setHistRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState({ supabaseOk: null, aiEnabled: false, aiProviders: [] });
  const [hours, setHoursState] = useState(CHART_VIEW_DEFAULTS.hours);
  const [smooth, setSmoothState] = useState(CHART_VIEW_DEFAULTS.smooth);
  const [pollTick, setPollTick] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const inFlight = useRef(false);
  const lastReadingId = useRef(null);
  const deviceRef = useRef(null);
  const hoursRef = useRef(hours);

  // Restore persisted view settings once on mount.
  useEffect(() => {
    const savedDevice = localStorage.getItem(STORAGE.deviceId);
    if (savedDevice) {
      deviceRef.current = savedDevice;
      setDeviceIdState(savedDevice);
    }
    const savedHours = Number(localStorage.getItem(STORAGE.chartHours));
    if (Number.isFinite(savedHours) && savedHours >= 1) {
      hoursRef.current = savedHours;
      setHoursState(savedHours);
    }
    const savedSmooth = Number(localStorage.getItem(STORAGE.chartSmooth));
    if (Number.isFinite(savedSmooth) && savedSmooth >= 1) setSmoothState(savedSmooth);
  }, []);

  const fetchDashboard = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const q = new URLSearchParams({
        hours: String(hoursRef.current),
        history_limit: String(CHART_VIEW_DEFAULTS.maxPoints),
      });
      if (deviceRef.current) q.set('device_id', deviceRef.current);
      const r = await fetch(`${settings.apiBase}/api/dashboard?${q}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const pack = await r.json();

      setDevices(pack.devices ?? []);
      if (pack.device_id && pack.device_id !== deviceRef.current) {
        deviceRef.current = pack.device_id;
        setDeviceIdState(pack.device_id);
        localStorage.setItem(STORAGE.deviceId, pack.device_id);
      }
      setHistRows(pack.history?.data ?? []);
      setStats(pack.stats ?? null);
      if (pack.latest) {
        setLatest(pack.latest);
        if (pack.latest.id !== lastReadingId.current) {
          lastReadingId.current = pack.latest.id;
          const d = pack.latest;
          addLog(
            `[${d.device_id ?? '?'}] ${readingLine(d)} · คะแนน ${d.health_score ?? '--'}`,
            'ok'
          );
        }
      }
      setPollTick((t) => t + 1);
    } catch (e) {
      addLog(`โหลดข้อมูลไม่สำเร็จ: ${e.message}`, 'err');
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, [settings.apiBase, addLog]);

  const checkHealth = useCallback(async () => {
    try {
      const r = await fetch(`${settings.apiBase}/api/health`, { cache: 'no-store' });
      const d = await r.json();
      setHealth({
        supabaseOk: !!d.supabase_ok,
        aiEnabled: !!d.ai_enabled,
        aiProviders: Array.isArray(d.ai_providers) ? d.ai_providers : [],
      });
    } catch {
      setHealth({ supabaseOk: false, aiEnabled: false, aiProviders: [] });
    }
  }, [settings.apiBase]);

  // Main polling loop (paused while the tab is hidden).
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) fetchDashboard();
    };
    // Initial load always fetches — even in a background tab — so the UI
    // is populated the moment it becomes visible. Polls stay hidden-gated.
    fetchDashboard();
    checkHealth();
    const pollMs = Math.min(serverCfg.pollMsMax, Math.max(serverCfg.pollMsMin, settings.pollMs));
    const poll = setInterval(tick, pollMs);
    const healthPoll = setInterval(checkHealth, serverCfg.healthPollMs);
    const onVisible = () => {
      if (!document.hidden) fetchDashboard();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(healthPoll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchDashboard, checkHealth, settings.pollMs, serverCfg.pollMsMin, serverCfg.pollMsMax, serverCfg.healthPollMs]);

  const setDevice = useCallback(
    (id) => {
      deviceRef.current = id || null;
      setDeviceIdState(id || null);
      if (id) localStorage.setItem(STORAGE.deviceId, id);
      setLatest(null);
      setHistRows([]);
      lastReadingId.current = null;
      addLog(`เปลี่ยนอุปกรณ์: ${id}`, 'info');
      fetchDashboard();
    },
    [fetchDashboard, addLog]
  );

  const setHours = useCallback(
    (h) => {
      hoursRef.current = h;
      setHoursState(h);
      localStorage.setItem(STORAGE.chartHours, String(h));
      fetchDashboard();
    },
    [fetchDashboard]
  );

  const setSmooth = useCallback((n) => {
    setSmoothState(n);
    localStorage.setItem(STORAGE.chartSmooth, String(n));
  }, []);

  const refresh = useCallback(() => {
    checkHealth();
    fetchDashboard();
    addLog('รีเฟรชข้อมูลแล้ว', 'info');
  }, [checkHealth, fetchDashboard, addLog]);

  return {
    devices,
    deviceId,
    latest,
    histRows,
    stats,
    health,
    hours,
    smooth,
    pollTick,
    loaded,
    setDevice,
    setHours,
    setSmooth,
    refresh,
  };
}
