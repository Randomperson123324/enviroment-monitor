'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, X, ArrowUp } from 'lucide-react';
import { CHAT_MAX_TURNS } from '@/config/client';
import { aiJsonHeaders } from '@/lib/ai-client';
import { useLang } from '@/hooks/useLang';

/** "gemma4-e4b (via relay)" — what actually answered, not what's configured. */
function sourceLabel(t, res) {
  if (!res?.provider) return '';
  // No model ran: the rule engine in lib/analysis.js replied.
  const name = res.provider === 'local-rules' ? t('ai.srcLocal') : res.model || res.provider;
  return res.via === 'relay' ? t('ai.viaRelay', { name }) : name;
}

function ChatPane({ deviceId, settings, addLog, onSource }) {
  const { t } = useLang();
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
        headers: aiJsonHeaders(settings),
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
      onSource?.(data);
      setMessages((prev) => {
        const next = [...prev, { role: 'assistant', content: data.reply ?? '—', ts: new Date() }];
        return next.length > CHAT_MAX_TURNS ? next.slice(next.length - CHAT_MAX_TURNS) : next;
      });
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: t('ai.chatError', { msg: e.message }), ts: new Date() },
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
            {t('ai.chatEmpty1')}
            <br />
            {t('ai.chatEmpty2')}
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
          placeholder={t('ai.chatPlaceholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="chat-send" onClick={send} disabled={busy} title={t('ai.send')}>
          <ArrowUp size={17} strokeWidth={2.4} aria-hidden />
        </button>
      </div>
    </>
  );
}

/**
 * AI assistant as a floating action button (bottom-right) with a glass popover.
 *
 * Chat only. It used to open on an "analysis" tab that re-ran the very analysis
 * the page already shows: the score card carries the rule engine's
 * recommendations, and every tab has its own cached AI summary above the
 * content. Two routes to the same paragraph — one of them spending a model call
 * on demand — so the assistant now does the one thing nothing else does, which
 * is answer a question.
 */
export default function FloatingAi({ deviceId, settings, serverAi, addLog }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [lastSource, setLastSource] = useState(null);

  // The "/" shortcut lives in Dashboard (one global key listener for the app) and
  // reaches the assistant through this event, so the panel keeps owning its own
  // open state instead of having it lifted into the page for one keystroke.
  useEffect(() => {
    const openPanel = () => setOpen(true);
    window.addEventListener('env-monitor:open-ai', openPanel);
    return () => window.removeEventListener('env-monitor:open-ai', openPanel);
  }, []);

  // Until something answers we can only name the chain the server would use.
  const source =
    sourceLabel(t, lastSource) || (serverAi?.length ? serverAi.join(' → ') : t('ai.local'));

  return (
    <>
      {open && (
        <div className="panel ai-panel ai-float" role="dialog" aria-label={t('ai.dialog')}>
          <div className="subhdr">
            <span className="panel-title ai-float-title">
              <Bot size={17} strokeWidth={2.2} aria-hidden /> {t('ai.title')}
            </span>
            <span className="src-tag">{source}</span>
          </div>
          <ChatPane
            deviceId={deviceId}
            settings={settings}
            addLog={addLog}
            onSource={setLastSource}
          />
        </div>
      )}
      <button
        className={`fab ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={open ? t('ai.close') : `${t('ai.openAi')} (/)`}
        aria-expanded={open}
      >
        {open ? <X size={22} strokeWidth={2.2} /> : <Bot size={24} strokeWidth={2} />}
      </button>
    </>
  );
}
