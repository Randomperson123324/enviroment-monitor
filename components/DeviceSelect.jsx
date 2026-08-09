'use client';

import { useLang } from '@/hooks/useLang';

/** Device picker, shared by the top bar and the sidebar. */
export default function DeviceSelect({ devices, deviceId, onSelectDevice }) {
  const { t } = useLang();

  return (
    <div className="dev-select">
      <span>{t('header.device')}</span>
      <select
        value={deviceId ?? ''}
        onChange={(e) => onSelectDevice(e.target.value)}
        disabled={!devices.length}
        aria-label={t('header.selectDevice')}
      >
        {devices.length ? (
          devices.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))
        ) : (
          <option value="">{t('header.noData')}</option>
        )}
      </select>
    </div>
  );
}
