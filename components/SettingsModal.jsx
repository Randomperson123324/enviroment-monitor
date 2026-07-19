'use client';

import { useState } from 'react';
import { Settings } from 'lucide-react';

export default function SettingsModal({ settings, serverCfg, onSave, onClose }) {
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
          <Settings size={18} strokeWidth={2.2} aria-hidden /> ตั้งค่า
        </h3>
        <div className="field">
          <label>ที่อยู่เซิร์ฟเวอร์ API (เว้นว่าง = เซิร์ฟเวอร์เดียวกัน)</label>
          <input type="text" value={apiBase} onChange={(e) => setApiBase(e.target.value)} />
        </div>
        <div className="field">
          <label>Gemini API Key (ไม่บังคับ — ใช้แทนของเซิร์ฟเวอร์)</label>
          <input
            type="password"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder="เว้นว่างไว้เพื่อใช้ key ของเซิร์ฟเวอร์"
          />
        </div>
        <p className="field-hint">
          อุปกรณ์ส่งข้อมูลเข้า <code>POST /api/ingest</code> ด้วย 3 ค่า:{' '}
          <code>temperature</code>, <code>humidity</code>, <code>gas_ppm</code>{' '}
          (หรือ <code>temp</code>, <code>hum</code>, <code>gas</code>)
        </p>
        <div className="field">
          <label>ความถี่อัปเดตข้อมูล (วินาที)</label>
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
            ยกเลิก
          </button>
          <button className="btn btn-primary" onClick={save}>
            บันทึก
          </button>
        </div>
      </div>
    </div>
  );
}
