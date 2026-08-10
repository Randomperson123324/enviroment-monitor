'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gauge } from 'lucide-react';
import { STORAGE, TABS } from '@/config/client';
import { LanguageProvider, useLang } from '@/hooks/useLang';
import useTheme from '@/hooks/useTheme';
import useSettings from '@/hooks/useSettings';
import useLogs from '@/hooks/useLogs';
import useServerConfig from '@/hooks/useServerConfig';
import useDashboard from '@/hooks/useDashboard';
import useAiSummary from '@/hooks/useAiSummary';
import useDataStatus from '@/hooks/useDataStatus';
import useToasts from '@/hooks/useToasts';
import useShortcuts from '@/hooks/useShortcuts';
import AiSummary from '@/components/AiSummary';
import { StatusNotice } from '@/components/DataStatus';
import Toasts from '@/components/Toasts';
import ShortcutHelp from '@/components/ShortcutHelp';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import TabMenu from '@/components/TabMenu';
import AlertBar from '@/components/AlertBar';
import SectionHeader from '@/components/SectionHeader';
import Overview from '@/components/Overview';
import WebcamStrip from '@/components/WebcamStrip';
import SensorTiles from '@/components/SensorTiles';
import ChartsSection from '@/components/ChartsSection';
import StatsTable from '@/components/StatsTable';
import DiseasePanel from '@/components/DiseasePanel';
import FocusSection from '@/components/FocusSection';
import HydroSection from '@/components/HydroSection';
import LogPanel from '@/components/LogPanel';
import FloatingAi from '@/components/FloatingAi';
import SettingsModal from '@/components/SettingsModal';

export default function Dashboard() {
  return (
    <LanguageProvider>
      <DashboardInner />
    </LanguageProvider>
  );
}

function DashboardInner() {
  const { t } = useLang();
  const [theme, toggleTheme] = useTheme();
  const { settings, save } = useSettings();
  const { logs, addLog, clearLogs } = useLogs();
  const serverCfg = useServerConfig(settings.apiBase, addLog);
  const dash = useDashboard({ settings, serverCfg, addLog });
  const status = useDataStatus(dash.latest?.created_at);
  const { toasts, notify, dismiss } = useToasts();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tab, setTab] = useState(TABS[0].id);

  // One cached summary per tab, generated server-side at most every 30 min.
  // Only the visible tab polls — a hidden tab shouldn't hold a refresh timer.
  const summaryArgs = {
    apiBase: settings.apiBase,
    settings,
    pollMs: serverCfg.aiSummaryPollMs,
  };
  const envAi = useAiSummary({
    ...summaryArgs,
    scope: 'environment',
    deviceId: dash.deviceId,
    enabled: tab === 'environment',
  });
  const focusAi = useAiSummary({ ...summaryArgs, scope: 'focus', enabled: tab === 'focus' });
  const hydroAi = useAiSummary({
    ...summaryArgs,
    scope: 'hydro',
    deviceId: dash.deviceId,
    enabled: tab === 'hydro',
  });

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE.activeTab);
    if (TABS.some((t) => t.id === saved)) setTab(saved);
  }, []);

  const switchTab = useCallback((id) => {
    setTab(id);
    localStorage.setItem(STORAGE.activeTab, id);
  }, []);

  /** Confirms only what happened: a 403 from a wrong API base is not a refresh. */
  const refresh = useCallback(async () => {
    const res = await dash.refresh();
    if (res?.ok === false) notify(t('toast.refreshFailed', { msg: res.error }), 'err');
    else if (res?.ok) notify(t('toast.refreshed'));
  }, [dash, notify, t]);

  /**
   * Keyboard shortcuts (see SHORTCUTS in config/client.js). `close` unwinds the
   * topmost layer only, so Esc from the help sheet doesn't also shut Settings.
   */
  const shortcutHandlers = useMemo(
    () => ({
      tab1: () => switchTab(TABS[0].id),
      tab2: () => switchTab(TABS[1].id),
      tab3: () => switchTab(TABS[2].id),
      refresh,
      theme: toggleTheme,
      settings: () => setSettingsOpen(true),
      help: () => setHelpOpen((o) => !o),
      ai: () => window.dispatchEvent(new CustomEvent('env-monitor:open-ai')),
      close: () => {
        if (helpOpen) setHelpOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
      },
    }),
    [switchTab, refresh, toggleTheme, helpOpen, settingsOpen]
  );
  useShortcuts(shortcutHandlers);

  return (
    <div className="shell">
      <Sidebar activeTab={tab} onSelectTab={switchTab} />
      <Header
        theme={theme}
        onToggleTheme={toggleTheme}
        devices={dash.devices}
        deviceId={dash.deviceId}
        onSelectDevice={dash.setDevice}
        status={status}
        onRefresh={refresh}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        activeTab={tab}
        onSelectTab={switchTab}
      />
      <AlertBar latest={dash.latest} />
      {/* Says outright when the page is showing history rather than the room —
          or when it cannot reach the API at all. */}
      <StatusNotice
        status={status}
        api={{ ok: dash.apiOk, error: dash.apiError, base: settings.apiBase }}
      />

      {/* Desktop only — on mobile the same nav lives inside the burger panel. */}
      <TabMenu active={tab} onSelect={switchTab} className="standalone" />

      {tab === 'environment' && (
        <>
          <section className="section-gap">
            {/* No device meta here: the top bar names the device and its
                freshness, and repeating it made the two disagree while a poll
                was in flight. */}
            <SectionHeader Icon={Gauge} title={t('env.statusNow')} />
            <Overview
              latest={dash.latest}
              theme={theme}
              status={status}
              summary={envAi.data}
              summaryStyle={settings.aiSummaryStyle}
              summaryLoading={envAi.loading}
              onRefreshSummary={envAi.refresh}
            />
            <div className="tiles section-gap">
              <SensorTiles
                latest={dash.latest}
                histRows={dash.histRows}
                hours={dash.hours}
                smooth={dash.smooth}
                theme={theme}
                loading={!dash.loaded && !dash.latest}
              />
            </div>
          </section>
          <ChartsSection dash={dash} theme={theme} />
          <StatsTable
            stats={dash.stats}
            latest={dash.latest}
            theme={theme}
            loading={!dash.loaded && !dash.stats}
          />
        </>
      )}

      {tab === 'focus' && (
        <>
          <AiSummary
            title={t('aiSummary.titleFocus')}
            data={focusAi.data}
            style={settings.aiSummaryStyle}
            loading={focusAi.loading}
            error={focusAi.error}
            onRefresh={focusAi.refresh}
          />
          <WebcamStrip webcam={dash.latest?.webcam_json} />
          <FocusSection focusCfg={serverCfg.focus} addLog={addLog} theme={theme} />
        </>
      )}

      {tab === 'hydro' && (
        <>
          <AiSummary
            title={t('aiSummary.titleHydro')}
            data={hydroAi.data}
            style={settings.aiSummaryStyle}
            loading={hydroAi.loading}
            error={hydroAi.error}
            onRefresh={hydroAi.refresh}
          />
          <DiseasePanel latest={dash.latest} />
          <HydroSection apiBase={settings.apiBase} serverCfg={serverCfg} addLog={addLog} theme={theme} />
        </>
      )}

      <div className="section-gap">
        <LogPanel
          logs={logs}
          onClear={() => {
            clearLogs();
            notify(t('toast.logCleared'), 'info');
          }}
          onRefresh={refresh}
        />
      </div>

      <FloatingAi
        deviceId={dash.deviceId}
        settings={settings}
        serverAi={dash.health.aiProviders}
        addLog={addLog}
      />

      <Toasts toasts={toasts} onDismiss={dismiss} />
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          serverCfg={serverCfg}
          onSave={(patch) => {
            save(patch);
            addLog(`Config saved — poll ${(patch.pollMs ?? settings.pollMs) / 1000}s`, 'info');
            notify(t('toast.saved'));
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
