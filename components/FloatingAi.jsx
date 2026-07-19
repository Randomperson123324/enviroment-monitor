'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, X, ChartColumn, MessageCircle, Sparkles, ArrowUp } from 'lucide-react';
import { CHAT_MAX_TURNS } from '@/config/client';

function apiHeaders(settings) {
  const h = { 'Content-Type': 'application/json' };
  if (settings.geminiKey) h['X-Gemini-Key'] = settings.geminiKey;
  return h;
}

function AnalysisPane({ latest, deviceId, settings, serverGemini, addLog }) {
  const [override, setOverride] = useState(null);
  const [busy, setBusy] = useState(false);

  const ai = override ?? {
    source: latest?.ai_analysis?.ai_source === 'gemini' ? 'gemini' : 'local',
    recommendations: latest?.ai_analysis?.recommendations ?? null,
    summary: null,
  };

  const hint = settings.geminiKey
    ? 'ใช้ Gemini key จากเบราว์เซอร์ (override)'
    : serverGemini
      ? 'วิเคราะห์ผ่านเซิร์ฟเวอร์ (GEMINI_API_KEY)'
      : 'โหมด local — ตั้ง GEMINI_API_KEY บนโฮสต์ หรือใส่ key ใน Settings';

  const forceAnalyze = async () => {
    setBusy(true);
    addLog('ดึงข้อมูลล่าสุดจาก DB แล้ววิเคราะห์...', 'info');
    try {
      const r = await fetch(`${settings.apiBase}/api/gemini-analyze`, {
        method: 'POST',
        headers: apiHeaders(settings),
        body: JSON.stringify({
          device_id: deviceId,
          temperature: latest?.temperature,
          humidity: latest?.humidity,
          gas_ppm: latest?.gas_ppm,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const parsed = await r.json();
      setOverride({
        source: parsed.source,
        recommendations: parsed.recommendations,
        summary: parsed.summary,
      });
      addLog(`วิเคราะห์สำเร็จ (${parsed.source === 'gemini' ? 'Gemini' : 'ในเครื่อง'})`, 'ok');
    } catch (e) {
      addLog(`Analyze error: ${e.message}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="ai-body">
        {busy ? (
          <div className="ai-rec info">✨ Gemini กำลังวิเคราะห์...</div>
        ) : ai.recommendations?.length ? (
          <>
            {ai.summary ? <div className="ai-rec info">🤖 {ai.summary}</div> : null}
            {ai.recommendations.map((r, i) => (
              <div key={i} className={`ai-rec ${r.level ?? 'info'}`}>
                {r.text}
              </div>
            ))}
          </>
        ) : (
          <div className="ai-rec info">🤖 รอข้อมูลจากเซ็นเซอร์...</div>
        )}
      </div>
      <button className="analyze-btn" onClick={forceAnalyze} disabled={busy}>
        <Sparkles size={15} strokeWidth={2.2} aria-hidden /> วิเคราะห์ด้วย Gemini ตอนนี้
      </button>
      <div className="analyze-hint">{hint}</div>
    </>
  );
}

function ChatPane({ deviceId, settings, addLog }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, busy]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || busy) return;
    setInput('');
    const nextMsgs = [...messages, { role: 'user', content: msg, ts: new Date() }];
    setMessages(nextMsgs);
    setBusy(true);
    try {
      const r = await fetch(`${settings.apiBase}/api/chat`, {
        method: 'POST',
        headers: apiHeaders(settings),
        body: JSON.stringify({
          message: msg,
          history: nextMsgs.slice(0, -1).slice(-CHAT_MAX_TURNS / 2).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          device_id: deviceId,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setMessages((prev) => {
        const next = [...prev, { role: 'assistant', content: data.reply ?? '—', ts: new Date() }];
        return next.length > CHAT_MAX_TURNS ? next.slice(next.length - CHAT_MAX_TURNS) : next;
      });
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `⚠️ ขออภัย เกิดข้อผิดพลาด: ${e.message}`, ts: new Date() },
      ]);
      addLog(`Chat error: ${e.message}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="chat-msgs" ref={bodyRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            ถามเกี่ยวกับสภาพแวดล้อมในห้อง
            <br />
            ข้อมูลเซ็นเซอร์จะถูกแนบไปอัตโนมัติ
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role === 'user' ? 'user' : 'bot'}`}>
            <div className="chat-bubble">{m.content}</div>
            <div className="chat-time">
              {m.ts.toLocaleTimeString('th-TH', { hour12: false, hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}
        {busy && (
          <div className="chat-msg bot">
            <div className="chat-bubble">…</div>
          </div>
        )}
      </div>
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          rows={1}
          placeholder="ถามเกี่ยวกับสภาพแวดล้อม..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="chat-send" onClick={send} disabled={busy} title="ส่ง">
          <ArrowUp size={17} strokeWidth={2.4} aria-hidden />
        </button>
      </div>
    </>
  );
}

/** AI assistant as a floating action button (bottom-right) with a glass popover. */
export default function FloatingAi({ latest, deviceId, settings, serverGemini, addLog }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('recs');
  const source = settings.geminiKey || serverGemini ? 'Gemini' : 'ในเครื่อง';

  return (
    <>
      {open && (
        <div className="panel ai-panel ai-float" role="dialog" aria-label="ผู้ช่วย AI">
          <div className="subhdr">
            <span className="panel-title ai-float-title">
              <Bot size={17} strokeWidth={2.2} aria-hidden /> ผู้ช่วย AI
            </span>
            <span className="src-tag">{source}</span>
          </div>
          <div className="ai-tabs">
            <button
              className={`ai-tab ${tab === 'recs' ? 'active' : ''}`}
              onClick={() => setTab('recs')}
            >
              <ChartColumn size={14} strokeWidth={2.2} aria-hidden /> วิเคราะห์
            </button>
            <button
              className={`ai-tab ${tab === 'chat' ? 'active' : ''}`}
              onClick={() => setTab('chat')}
            >
              <MessageCircle size={14} strokeWidth={2.2} aria-hidden /> แชท
            </button>
          </div>
          {tab === 'recs' ? (
            <AnalysisPane
              latest={latest}
              deviceId={deviceId}
              settings={settings}
              serverGemini={serverGemini}
              addLog={addLog}
            />
          ) : (
            <ChatPane deviceId={deviceId} settings={settings} addLog={addLog} />
          )}
        </div>
      )}
      <button
        className={`fab ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={open ? 'ปิดผู้ช่วย AI' : 'เปิดผู้ช่วย AI'}
        aria-expanded={open}
      >
        {open ? <X size={22} strokeWidth={2.2} /> : <Bot size={24} strokeWidth={2} />}
      </button>
    </>
  );
}
