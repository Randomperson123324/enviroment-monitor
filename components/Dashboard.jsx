'use client';

import { useEffect, useState } from 'react';
import { Leaf, Eye, Waves, Gauge } from 'lucide-react';
import { STORAGE, TABS } from '@/config/client';
import useTheme from '@/hooks/useTheme';
import useSettings from '@/hooks/useSettings';
import useLogs from '@/hooks/useLogs';
import useServerConfig from '@/hooks/useServerConfig';
import useDashboard from '@/hooks/useDashboard';
import Header from '@/components/Header';
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

const TAB_ICONS = { environment: Leaf, focus: Eye, hydro: Waves };

export default function Dashboard() {
  const [theme, toggleTheme] = useTheme();
  const { settings, save } = useSettings();
  const { logs, addLog, clearLogs } = useLogs();
  const serverCfg = useServerConfig(settings.apiBase, addLog);
  const dash = useDashboard({ settings, serverCfg, addLog });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState(TABS[0].id);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE.activeTab);
    if (TABS.some((t) => t.id === saved)) setTab(saved);
  }, []);

  const switchTab = (id) => {
    setTab(id);
    localStorage.setItem(STORAGE.activeTab, id);
  };

  return (
    <div className="shell">
      <Header
        theme={theme}
        onToggleTheme={toggleTheme}
        devices={dash.devices}
        deviceId={dash.deviceId}
        onSelectDevice={dash.setDevice}
        latest={dash.latest}
        health={dash.health}
        onRefresh={dash.refresh}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <AlertBar latest={dash.latest} />

      <nav className="tab-menu" aria-label="เลือกหมวดข้อมูล">
        {TABS.map((t) => {
          const Icon = TAB_ICONS[t.id];
          return (
            <button
              key={t.id}
              className={`tab-item ${tab === t.id ? 'active' : ''}`}
              onClick={() => switchTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              <Icon size={17} strokeWidth={2.2} aria-hidden />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {tab === 'environment' && (
        <>
          <section className="section-gap">
            <SectionHeader
              Icon={Gauge}
              title="สถานะปัจจุบัน"
              meta={dash.latest?.device_id ? `อุปกรณ์ ${dash.latest.device_id}` : ''}
            />
            <Overview latest={dash.latest} theme={theme} />
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
          <DiseasePanel latest={dash.latest} />
        </>
      )}

      {tab === 'focus' && (
        <>
          <WebcamStrip webcam={dash.latest?.webcam_json} />
          <FocusSection focusCfg={serverCfg.focus} addLog={addLog} theme={theme} />
        </>
      )}

      {tab === 'hydro' && (
        <HydroSection apiBase={settings.apiBase} serverCfg={serverCfg} addLog={addLog} theme={theme} />
      )}

      <div className="section-gap">
        <LogPanel logs={logs} onClear={clearLogs} onRefresh={dash.refresh} />
      </div>

      <FloatingAi
        latest={dash.latest}
        deviceId={dash.deviceId}
        settings={settings}
        serverGemini={dash.health.geminiEnabled}
        addLog={addLog}
      />

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          serverCfg={serverCfg}
          onSave={(patch) => {
            save(patch);
            addLog(`Config saved — poll ${(patch.pollMs ?? settings.pollMs) / 1000}s`, 'info');
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
