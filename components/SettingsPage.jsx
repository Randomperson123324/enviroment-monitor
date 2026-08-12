'use client';

/**
 * The settings routes, /setting and /dev-setting, sharing one shell.
 *
 * Settings used to be a modal over the dashboard. A page is what they actually
 * are: somewhere you go, land on with a link, and come back from — the on-device
 * model download in particular is a multi-minute job that had no business living
 * in a dialog you could dismiss by clicking the backdrop.
 *
 * Each page owns its own copies of the hooks. They read the same localStorage and
 * the same /api/config as the dashboard's, so there is nothing to hand across the
 * navigation, and the dashboard re-reads what was saved when you go back.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, Wrench } from 'lucide-react';
import useSettings from '@/hooks/useSettings';
import useServerConfig from '@/hooks/useServerConfig';
import useBrowserAi from '@/hooks/useBrowserAi';
import useLogs from '@/hooks/useLogs';
import { LanguageProvider, useLang } from '@/hooks/useLang';
import SettingsForm from '@/components/SettingsForm';

/** The provider lives in the dashboard's tree, and these pages are not in it. */
export default function SettingsPage({ scope = 'user' }) {
  return (
    <LanguageProvider>
      <SettingsPageInner scope={scope} />
    </LanguageProvider>
  );
}

function SettingsPageInner({ scope }) {
  const { t } = useLang();
  const router = useRouter();
  const { settings, save } = useSettings();
  const { addLog } = useLogs();
  const serverCfg = useServerConfig(settings.apiBase, addLog);
  const browserAi = useBrowserAi({ enabled: serverCfg.ai?.browserEnabled !== false });

  // Back to wherever you came from when that was this app, and to the dashboard
  // when the page was opened cold — a typed /dev-setting has no history to pop.
  const leave = () => {
    if (window.history.length > 1) router.back();
    else router.push('/');
  };

  /** "Saved" confirms the write, then gets out of the way. */
  const [savedAt, setSavedAt] = useState(0);
  useEffect(() => {
    if (!savedAt) return;
    const id = setTimeout(() => setSavedAt(0), 2600);
    return () => clearTimeout(id);
  }, [savedAt]);

  return (
    <main className="set-page">
      <div className="set-page-bar">
        <Link className="set-back" href="/">
          <ArrowLeft size={15} strokeWidth={2.2} aria-hidden />
          {t('settings.back')}
        </Link>
        {/* Only one way, and only from the user page: the developer page is not
            something to stumble into, but once you are there the way out is the
            same back link as everywhere else. */}
        {scope === 'user' && (
          <Link className="set-devlink" href="/dev-setting">
            <Wrench size={13} strokeWidth={2.2} aria-hidden />
            {t('settings.devTitle')}
          </Link>
        )}
        {savedAt > 0 && (
          <span className="set-saved" role="status" aria-live="polite">
            <Check size={13} strokeWidth={2.6} aria-hidden />
            {t('toast.saved')}
          </span>
        )}
      </div>

      <SettingsForm
        scope={scope}
        settings={settings}
        serverCfg={serverCfg}
        browserAi={browserAi}
        // Saving keeps you here. A dialog closed because it was in the way of the
        // dashboard; a page is a place, and the next thing someone does after
        // changing the model is usually change the endpoint too.
        onSave={(patch) => {
          save(patch);
          setSavedAt(Date.now());
        }}
        onClose={leave}
      />
    </main>
  );
}
