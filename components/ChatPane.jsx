'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, Brain, ChevronDown, Cpu, Globe, Square, Wrench } from 'lucide-react';
import { CHAT_MAX_TURNS } from '@/config/client';
import { aiJsonHeaders } from '@/lib/ai-client';
import { chatEvents } from '@/lib/chat-client';
import { browserChatEvents, clearContextCache } from '@/lib/ai/browser/chat';
import { interrupt as interruptBrowser } from '@/lib/ai/browser/engine';
import { useLang } from '@/hooks/useLang';
import Markdown from '@/components/Markdown';

/**
 * The conversation itself: streamed answers, the model's thoughts while it
 * works, and a chip per tool call.
 *
 * Split out of FloatingAi because that file owns the *window* — docking,
 * dragging, resizing, the FAB — and this one owns the *turn*. They changed for
 * unrelated reasons every time, which is the usual sign.
 *
 * ── Why the tool chips are visible ───────────────────────────────────────────
 * The assistant no longer receives sensor data in its prompt; it asks for what a
 * question needs. That is invisible from the outside, and invisible fetching is
 * indistinguishable from invention — so each call is shown as it happens. It
 * also answers "why is this taking eight seconds" without anyone having to ask.
 */

/** A tool's Thai/English name, or its raw id if it has no label yet. */
function toolLabel(t, name) {
  const label = t(`ai.tools.${name}`);
  return label === `ai.tools.${name}` ? name : label;
}

function ToolChip({ t, call }) {
  const state = call.running ? 'running' : call.ok ? 'done' : 'failed';
  return (
    <span className={`chat-tool ${state}`} title={call.note ?? undefined}>
      <Wrench size={11} strokeWidth={2.2} aria-hidden />
      {toolLabel(t, call.name)}
      {call.running && <span className="chat-tool-dots" aria-hidden />}
    </span>
  );
}

/**
 * The thinking block. Open while the model is still thinking, collapsed the
 * moment the answer starts: reasoning is interesting *until* there is a real
 * answer to read, and then it is in the way.
 */
function Thoughts({ t, msg, onToggle }) {
  const bodyRef = useRef(null);

  useEffect(() => {
    if (msg.thinkOpen && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msg.thinking, msg.thinkOpen]);

  const live = msg.streaming && !msg.content;
  return (
    <div className={`chat-think ${msg.thinkOpen ? 'open' : ''}`}>
      <button className="chat-think-head" onClick={onToggle} aria-expanded={msg.thinkOpen}>
        <Brain size={12} strokeWidth={2.2} aria-hidden />
        <span>{live ? t('ai.thinkingLive') : t('ai.thoughtTitle')}</span>
        <ChevronDown size={12} strokeWidth={2.4} className="chat-think-caret" aria-hidden />
      </button>
      {msg.thinkOpen && (
        <div className="chat-think-body" ref={bodyRef}>
          {msg.thinking}
        </div>
      )}
    </div>
  );
}

export default function ChatPane({ deviceId, settings, caps, ai, onOpenSettings, addLog, onSource }) {
  const { t, lang } = useLang();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(false);
  const [thinking, setThinking] = useState(false);
  const bodyRef = useRef(null);
  const abortRef = useRef(null);

  const onBrowser = ai?.kind === 'browser';

  // Absent config is treated as capable: /api/config may not have answered yet,
  // and the fallback path below recovers from a wrong guess on its own.
  const canSearch = caps?.searchConfigured !== false;
  const canStream = caps?.streaming !== false;

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  // A turn left running after the panel closes still costs tokens and still
  // writes into state that no longer has anywhere to go.
  useEffect(() => () => abortRef.current?.abort(), []);

  // The browser engine's prompt is cached to keep the model's KV cache warm, so
  // switching device has to drop it or the next answer describes the old room.
  useEffect(() => {
    clearContextCache();
  }, [deviceId]);

  /**
   * Patch the assistant message being streamed — always the last one, because
   * the composer is disabled until the turn ends.
   */
  const patchLast = (fn) =>
    setMessages((prev) => {
      const i = prev.length - 1;
      if (i < 0 || prev[i].role !== 'assistant') return prev;
      const next = [...prev];
      next[i] = fn(next[i]);
      return next;
    });

  const toggleThoughts = (index) =>
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, thinkOpen: !m.thinkOpen } : m))
    );

  /** Non-streaming /api/chat, used when the stream never got started. */
  const sendPlain = async (msg, history, signal) => {
    const r = await fetch(`${settings.apiBase}/api/chat`, {
      method: 'POST',
      headers: aiJsonHeaders(settings),
      body: JSON.stringify({ message: msg, history, device_id: deviceId }),
      signal,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
    return data;
  };

  const send = async () => {
    const msg = input.trim();
    if (!msg || busy) return;
    setInput('');

    const history = messages
      .slice(-CHAT_MAX_TURNS)
      .map((m) => ({ role: m.role, content: m.content }))
      .filter((m) => m.content);

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: msg, ts: new Date() },
      {
        role: 'assistant',
        content: '',
        thinking: '',
        // Open from the start when thinking was asked for, so the block does not
        // pop in and shove the conversation down a second later.
        thinkOpen: thinking,
        tools: [],
        status: null,
        streaming: true,
        error: null,
        ts: new Date(),
      },
    ]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let produced = false;

    try {
      if (!onBrowser && !canStream) throw new Error('streaming disabled');
      const events = onBrowser
        ? browserChatEvents({
            messages: [...history, { role: 'user', content: msg }],
            apiBase: settings.apiBase,
            deviceId,
            lang,
            modelId: ai.modelId,
            thinking,
            sendContext: ai.sendContext,
            labels: {
              fetchingContext: t('bai.statusContext'),
              loadingModel: t('bai.statusLoading'),
              preparingModel: t('bai.statusPreparing'),
              analyzingPrompt: t('bai.statusPrefill'),
              thinking: t('bai.statusWaiting'),
              thinkingStatus: t('ai.thinkingLive'),
            },
            signal: controller.signal,
          })
        : chatEvents({
            url: `${settings.apiBase}/api/chat/stream`,
            headers: aiJsonHeaders(settings),
            body: {
              message: msg,
              history,
              device_id: deviceId,
              lang,
              search: search && canSearch,
              thinking,
            },
            signal: controller.signal,
          });

      for await (const ev of events) {
        switch (ev.type) {
          case 'start':
            onSource?.({ provider: ev.provider, model: ev.model });
            break;
          case 'thinking':
            patchLast((m) => ({
              ...m,
              thinking: m.thinking + ev.text,
              thinkOpen: m.content ? m.thinkOpen : true,
            }));
            break;
          case 'delta':
            produced = true;
            patchLast((m) => ({
              ...m,
              content: m.content + ev.text,
              // Collapse exactly once — on the first text — so a user who
              // re-opens the thoughts mid-answer keeps them open.
              thinkOpen: m.content ? m.thinkOpen : false,
              status: null,
            }));
            break;
          // The browser engine has no tool calls to show; this is what it
          // reports instead — downloading, prefilling, waiting for a token.
          case 'status':
            patchLast((m) => ({ ...m, status: ev.text }));
            break;
          case 'tool-start':
            patchLast((m) => ({
              ...m,
              tools: [...m.tools, { name: ev.name, args: ev.args, running: true }],
            }));
            break;
          case 'tool':
            produced = true;
            patchLast((m) => ({
              ...m,
              tools: m.tools.map((c) =>
                c.running && c.name === ev.name
                  ? { ...c, running: false, ok: ev.ok, note: ev.note }
                  : c
              ),
            }));
            break;
          case 'error':
            patchLast((m) => ({ ...m, error: ev.message }));
            addLog(`Chat: ${ev.message}`, 'warn');
            break;
          default:
            break;
        }
      }
    } catch (e) {
      if (controller.signal.aborted) {
        patchLast((m) => ({ ...m, error: m.content ? null : t('ai.stopped') }));
      } else if (produced || onBrowser) {
        // Half an answer is already on screen; say what broke and keep it.
        //
        // The browser engine never falls back either, even having produced
        // nothing: someone who chose to keep the conversation on this machine
        // did not ask for it to be quietly sent to a provider instead.
        patchLast((m) => ({ ...m, error: e.message, status: null }));
        addLog(`Chat ${onBrowser ? 'browser' : 'stream'}: ${e.message}`, 'err');
      } else {
        // Nothing shipped yet, so the plain endpoint can still answer this turn.
        addLog(`Chat stream failed, using /api/chat: ${e.message}`, 'warn');
        try {
          const data = await sendPlain(msg, history, controller.signal);
          onSource?.(data);
          patchLast((m) => ({ ...m, content: data.reply ?? '—' }));
        } catch (e2) {
          patchLast((m) => ({ ...m, error: e2.message }));
          addLog(`Chat error: ${e2.message}`, 'err');
        }
      }
    } finally {
      patchLast((m) => ({ ...m, streaming: false, status: null }));
      setMessages((prev) =>
        prev.length > CHAT_MAX_TURNS ? prev.slice(prev.length - CHAT_MAX_TURNS) : prev
      );
      abortRef.current = null;
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
              {onBrowser ? t('bai.emptyHint', { model: ai.model.label }) : t('ai.chatEmpty2')}
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role === 'user' ? 'user' : 'bot'}`}>
            {m.role === 'assistant' && m.thinking && (
              <Thoughts t={t} msg={m} onToggle={() => toggleThoughts(i)} />
            )}
            {m.role === 'assistant' && m.tools?.length > 0 && (
              <div className="chat-tools">
                {m.tools.map((c, j) => (
                  <ToolChip key={j} t={t} call={c} />
                ))}
              </div>
            )}
            {m.role === 'assistant' && m.status && (
              <div className="chat-status">
                <span className="chat-tool-dots" aria-hidden />
                {m.status}
              </div>
            )}
            {m.role === 'user' ? (
              <div className="chat-bubble">{m.content}</div>
            ) : (
              // While a status line is showing there is nothing to put in a
              // bubble, and an empty one reads as a failed reply.
              (m.content || m.error || (m.streaming && !m.status)) && (
                <div className="chat-bubble">
                  {m.content ? (
                    <Markdown text={m.content} className="markdown chat-md" />
                  ) : (
                    m.streaming && <span className="chat-typing" aria-hidden />
                  )}
                  {m.error && <span className="chat-err">{t('ai.chatError', { msg: m.error })}</span>}
                </div>
              )
            )}
            <div className="chat-time">
              {m.ts.toLocaleTimeString(lang === 'en' ? 'en-GB' : 'th-TH', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="chat-input-row">
        <div className="chat-tgls">
          {/* A shortcut, not a second home for the setting: it opens the same
              Settings pane the gear does, already scrolled to the engine. */}
          <button
            className={`chat-tgl ${onBrowser ? 'on' : ''}`}
            onClick={() => onOpenSettings?.('device')}
            aria-label={t('bai.title')}
            title={t(onBrowser ? 'bai.onBrowser' : 'bai.onServer')}
          >
            <Cpu size={15} strokeWidth={2.2} aria-hidden />
          </button>
          {/* Web search belongs to the server tool loop; the browser model has
              no tools at all, so the button would promise something untrue. */}
          <button
            className={`chat-tgl ${search && canSearch && !onBrowser ? 'on' : ''}`}
            onClick={() => setSearch((v) => !v)}
            disabled={!canSearch || onBrowser}
            aria-pressed={search && canSearch && !onBrowser}
            aria-label={t('ai.search')}
            title={
              onBrowser
                ? t('bai.noSearch')
                : canSearch
                  ? t(search ? 'ai.searchOn' : 'ai.searchOff')
                  : t('ai.searchUnset')
            }
          >
            <Globe size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className={`chat-tgl ${thinking ? 'on' : ''}`}
            onClick={() => setThinking((v) => !v)}
            aria-pressed={thinking}
            aria-label={t('ai.thinkLabel')}
            title={t(thinking ? 'ai.thinkOn' : 'ai.thinkOff')}
          >
            <Brain size={15} strokeWidth={2.2} aria-hidden />
          </button>
        </div>

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

        {/* One button, two jobs: while a turn runs, the thing you want is stop. */}
        {busy ? (
          <button
            className="chat-send stop"
            onClick={() => {
              abortRef.current?.abort();
              // The abort signal stops the loop reading chunks; WebLLM also has
              // to be told, or it keeps generating into nothing.
              if (onBrowser) void interruptBrowser();
            }}
            title={t('ai.stop')}
            aria-label={t('ai.stop')}
          >
            <Square size={13} strokeWidth={3} aria-hidden />
          </button>
        ) : (
          <button className="chat-send" onClick={send} title={t('ai.send')} aria-label={t('ai.send')}>
            <ArrowUp size={17} strokeWidth={2.4} aria-hidden />
          </button>
        )}
      </div>
    </>
  );
}
