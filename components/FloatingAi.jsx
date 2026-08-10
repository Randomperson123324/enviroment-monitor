'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, X, ArrowUp, PanelRight, PictureInPicture2 } from 'lucide-react';
import { CHAT_MAX_TURNS } from '@/config/client';
import { aiJsonHeaders } from '@/lib/ai-client';
import { useLang } from '@/hooks/useLang';
import useAiWindow from '@/hooks/useAiWindow';

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
            <span className="chat-empty-mark">
              <Bot size={22} strokeWidth={1.9} aria-hidden />
            </span>
            <p className="chat-empty-title">{t('ai.greeting')}</p>
            <p className="chat-empty-hint">
              {t('ai.chatEmpty1')}
              <br />
              {t('ai.chatEmpty2')}
            </p>
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
  /** Kept mounted for the collapse animation, then dropped. */
  const [closing, setClosing] = useState(false);
  const [lastSource, setLastSource] = useState(null);

  // The "/" shortcut lives in Dashboard (one global key listener for the app) and
  // reaches the assistant through this event, so the panel keeps owning its own
  // open state instead of having it lifted into the page for one keystroke.
  useEffect(() => {
    const openPanel = () => {
      setClosing(false);
      setOpen(true);
    };
    window.addEventListener('env-monitor:open-ai', openPanel);
    return () => window.removeEventListener('env-monitor:open-ai', openPanel);
  }, []);

  const finishClose = () => {
    setOpen(false);
    setClosing(false);
  };

  // Safety net: the panel must never be left stuck open if the animation event
  // does not arrive (an interrupted transition, animations disabled outright).
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(finishClose, 400);
    return () => clearTimeout(timer);
  }, [closing]);

  const toggle = () => {
    // Pressing the button mid-collapse re-opens instead of doing nothing: the
    // panel is still on screen, so a press that appears to hit it must act.
    if (closing) setClosing(false);
    else if (open) setClosing(true);
    else setOpen(true);
  };

  // Desktop only: docked to the right edge, draggable out, snappable, resizable.
  const win = useAiWindow(open && !closing);

  const style = win.floating
    ? { left: win.rect.x, top: win.rect.y, width: win.rect.w, height: win.rect.h }
    : win.docked
      ? { width: win.dockWidth }
      : undefined;

  // Until something answers we can only name the chain the server would use.
  const source =
    sourceLabel(t, lastSource) || (serverAi?.length ? serverAi.join(' → ') : t('ai.local'));

  return (
    <>
      {open && (
        <div
          ref={win.panelRef}
          className={[
            'panel ai-panel ai-float',
            closing ? 'closing' : '',
            win.docked ? 'docked' : '',
            win.floating ? 'floating' : '',
            win.busy ? 'dragging' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={style}
          role="dialog"
          aria-label={t('ai.dialog')}
          // Child animations bubble here too, so only the panel's own counts.
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget && closing) finishClose();
          }}
          onPointerMove={win.onPointerMove}
          onPointerUp={win.onPointerUp}
          onPointerCancel={win.onPointerUp}
        >
          {/* Title bar: the drag handle on desktop, a plain header on mobile. */}
          <div
            className="subhdr ai-winbar"
            onPointerDown={win.startMove}
            onDoubleClick={win.desktop ? win.toggleDock : undefined}
          >
            <span className="panel-title ai-float-title">
              <Bot size={17} strokeWidth={2.2} aria-hidden /> {t('ai.title')}
            </span>
            <span className="src-tag">{source}</span>
            {win.desktop && (
              <button
                className="icon-btn ai-winbtn"
                onClick={win.toggleDock}
                title={win.docked ? t('ai.undock') : t('ai.dock')}
                aria-label={win.docked ? t('ai.undock') : t('ai.dock')}
              >
                {win.docked ? (
                  <PictureInPicture2 size={15} strokeWidth={2.2} aria-hidden />
                ) : (
                  <PanelRight size={15} strokeWidth={2.2} aria-hidden />
                )}
              </button>
            )}
            {win.desktop && (
              <button
                className="icon-btn ai-winbtn"
                onClick={() => setClosing(true)}
                title={t('ai.close')}
                aria-label={t('ai.close')}
              >
                <X size={15} strokeWidth={2.4} aria-hidden />
              </button>
            )}
          </div>

          <ChatPane
            deviceId={deviceId}
            settings={settings}
            addLog={addLog}
            onSource={setLastSource}
          />

          {/* Resize handles. The docked panel only owns its left edge — the other
              three sides are the screen. */}
          {win.docked && (
            <div
              className="ai-grip left"
              onPointerDown={(e) => win.startResize(e, 'left')}
              role="separator"
              aria-label={t('ai.resize')}
            />
          )}
          {win.floating && (
            <>
              <div className="ai-grip left" onPointerDown={(e) => win.startResize(e, 'left')} role="separator" aria-label={t('ai.resize')} />
              <div className="ai-grip right" onPointerDown={(e) => win.startResize(e, 'right')} role="separator" aria-label={t('ai.resize')} />
              <div className="ai-grip bottom" onPointerDown={(e) => win.startResize(e, 'bottom')} role="separator" aria-label={t('ai.resize')} />
              <div className="ai-grip corner" onPointerDown={(e) => win.startResize(e, 'bottom-right')} role="separator" aria-label={t('ai.resize')} />
            </>
          )}
        </div>
      )}

      {/* Drop preview for the snap zone, so the edge shows what a release does. */}
      {win.snapping && <div className="ai-snap-hint" aria-hidden />}
      <button
        className={`fab ${open && !closing ? 'open' : ''}`}
        onClick={toggle}
        title={open && !closing ? t('ai.close') : `${t('ai.openAi')} (/)`}
        aria-expanded={open && !closing}
      >
        {open && !closing ? <X size={22} strokeWidth={2.2} /> : <Bot size={24} strokeWidth={2} />}
      </button>
    </>
  );
}
