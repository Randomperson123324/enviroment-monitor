'use client';

/**
 * Where the assistant runs, and the on-device model's life cycle: pick, download,
 * delete. One pane of the settings dialog.
 *
 * Ported from StreeFlood's `engine-settings.tsx`, GPU path only. It started life
 * as a popover in the composer and moved here so every setting is behind one
 * button; the composer keeps a shortcut to this pane.
 *
 * The details that look like clutter each answer a question the user would
 * otherwise have to guess at: a 2.5 GB download needs its size stated before it
 * starts, delete asks twice because re-downloading is slow, and the GPU line is
 * the only explanation for why a machine was quietly moved to the larger q4f32
 * build.
 */

import { useEffect, useState } from 'react';
import { Check, Cloud, Cpu, Download, HardDrive, Trash2, TriangleAlert } from 'lucide-react';
import { useLang } from '@/hooks/useLang';

function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

export default function BrowserAiSettings({ ai }) {
  const { t } = useLang();
  const [storage, setStorage] = useState(null);
  const [deleteArmed, setDeleteArmed] = useState(false);

  useEffect(() => {
    void ai.getStorageEstimate().then(setStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDisk = ai.status.phase === 'cached' || ai.status.phase === 'ready';

  const handleDelete = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setDeleteArmed(false);
    await ai.removeModel();
    void ai.getStorageEstimate().then(setStorage);
  };

  return (
    <>
      <div className="bai-choices">
        <button
          className={`bai-choice ${ai.kind === 'server' ? 'on' : ''}`}
          onClick={() => ai.setKind('server')}
        >
          <Cloud size={15} strokeWidth={2.1} aria-hidden />
          <span className="bai-choice-name">{t('bai.server')}</span>
          <span className="bai-choice-note">{t('bai.serverNote')}</span>
          {ai.kind === 'server' && <Check size={14} strokeWidth={2.6} className="bai-tick" aria-hidden />}
        </button>

        <button
          className={`bai-choice ${ai.kind === 'browser' ? 'on' : ''}`}
          onClick={() => ai.setKind('browser')}
          disabled={ai.webgpu === false}
        >
          <Cpu size={15} strokeWidth={2.1} aria-hidden />
          <span className="bai-choice-name">{t('bai.browser')}</span>
          <span className="bai-choice-note">
            {ai.webgpu === false ? t('bai.noWebgpu') : t('bai.browserNote')}
          </span>
          {ai.kind === 'browser' && <Check size={14} strokeWidth={2.6} className="bai-tick" aria-hidden />}
        </button>
      </div>

      {/* Shown whatever the engine choice: the model can be fetched ahead of
          time, and a first question that starts a 2.5 GB download is a bad
          moment to discover the option existed. */}
      {ai.webgpu !== false && (
        <div className="bai-body">
          <div className="bai-label">{t('bai.model')}</div>
          {ai.models.map((m) => (
            <button
              key={m.id}
              className={`bai-model ${m.id === ai.modelId ? 'on' : ''}`}
              onClick={() => ai.setModel(m.id)}
            >
              <span className="bai-model-name">{m.label}</span>
              <span className="bai-model-size">{m.sizeText}</span>
              <span className="bai-model-desc">{t(`bai.desc.${m.descKey}`)}</span>
            </button>
          ))}

          {ai.f16Ok === false && (
            <p className="bai-warn">
              <TriangleAlert size={12} strokeWidth={2.2} aria-hidden /> {t('bai.noF16')}
            </p>
          )}

          <label className="bai-switch">
            <input
              type="checkbox"
              checked={ai.sendContext}
              onChange={(e) => ai.setSendContext(e.target.checked)}
            />
            <span>
              {t('bai.sendContext')}
              <em>{t('bai.sendContextNote')}</em>
            </span>
          </label>

          <div className="bai-actions">
            {ai.status.phase === 'downloading' ? (
              <div className="bai-progress">
                <div className="bai-bar" style={{ width: `${ai.status.progress ?? 0}%` }} />
                <span>{t('bai.downloading', { pct: ai.status.progress ?? 0 })}</span>
              </div>
            ) : (
              <button className="bai-btn" onClick={() => ai.loadModel()}>
                <Download size={13} strokeWidth={2.2} aria-hidden />
                {onDisk ? t('bai.load') : t('bai.download', { size: ai.model.sizeText })}
              </button>
            )}

            {onDisk && ai.status.phase !== 'downloading' && (
              <button className={`bai-btn danger ${deleteArmed ? 'armed' : ''}`} onClick={handleDelete}>
                <Trash2 size={13} strokeWidth={2.2} aria-hidden />
                {deleteArmed ? t('bai.deleteSure') : t('bai.delete')}
              </button>
            )}
          </div>

          {ai.status.phase === 'ready' && <p className="bai-note ok">{t('bai.ready')}</p>}
          {ai.status.phase === 'error' && (
            <p className="bai-note bad">{t('bai.failed', { msg: ai.status.message ?? '' })}</p>
          )}

          <div className="bai-facts">
            {ai.gpuInfo === undefined && <span>{t('bai.checkingGpu')}</span>}
            {ai.gpuInfo === null && <span>{t('bai.noAdapter')}</span>}
            {ai.gpuInfo && (
              <span>
                {t('bai.gpu', {
                  vendor: ai.gpuInfo.vendor || '?',
                  arch: ai.gpuInfo.architecture || '?',
                  f16: ai.gpuInfo.f16 ? 'f16' : 'f32',
                })}
              </span>
            )}
            {storage && (
              <span>
                <HardDrive size={11} strokeWidth={2.2} aria-hidden />{' '}
                {t('bai.storage', {
                  used: formatBytes(storage.usage),
                  quota: formatBytes(storage.quota),
                })}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
