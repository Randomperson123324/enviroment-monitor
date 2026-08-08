'use client';

import { useState } from 'react';
import { Settings } from 'lucide-react';
import { useLang } from '@/hooks/useLang';

export default function SettingsModal({ settings, serverCfg, onSave, onClose }) {
  const { t } = useLang();
  const [apiBase, setApiBase] = useState(settings.apiBase);
  const [geminiKey, setGeminiKey] = useState(settings.geminiKey);
  const [pollSec, setPollSec] = useState(settings.pollMs / 1000);

  const save = () => {
    const min = serverCfg.pollMsMin / 1000;
    const max = serverCfg.pollMsMax / 1000;
    const sec = Math.min(max, Math.max(min, Number(pollSec) || serverCfg.pollMsDefault / 1000));
    onSave({
      apiBase: apiBase.trim(),
      geminiKey: geminiKey.trim(),
      pollMs: sec * 1000,
    });
  };

  return (
    <div
      className="modal-ov"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <h3 className="ai-float-title">
          <Settings size={18} strokeWidth={2.2} aria-hidden /> {t('settings.title')}
        </h3>
        <div className="field">
          <label>{t('settings.apiBase')}</label>
          <input type="text" value={apiBase} onChange={(e) => setApiBase(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('settings.geminiKey')}</label>
          <input
            type="password"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder={t('settings.geminiPlaceholder')}
          />
        </div>
        <p className="field-hint">
          {t('settings.ingestHintPre')} <code>POST /api/ingest</code> {t('settings.ingestHintMid')}{' '}
          <code>temperature</code>, <code>humidity</code>, <code>gas_ppm</code>{' '}
          ({t('settings.ingestHintOr')} <code>temp</code>, <code>hum</code>, <code>gas</code>)
        </p>
        <div className="field">
          <label>{t('settings.pollSec')}</label>
          <input
            type="number"
            min={serverCfg.pollMsMin / 1000}
            max={serverCfg.pollMsMax / 1000}
            value={pollSec}
            onChange={(e) => setPollSec(e.target.value)}
          />
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            {t('settings.cancel')}
          </button>
          <button className="btn btn-primary" onClick={save}>
            {t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
