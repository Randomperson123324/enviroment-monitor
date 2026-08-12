'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, Brain, ChevronDown, Globe, Square, Wrench } from 'lucide-react';
import { CHAT_MAX_TURNS, aiChainFrom, aiChainRuns } from '@/config/client';
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

  /**
   * Asked for thoughts, finished, and none came: say so rather than showing
   * nothing. Gemini 3 leaves the thought text empty on most turns where it calls
   * a tool — the reasoning goes back as an encrypted thoughtSignature instead —
   * and every question about this room calls one, so the honest failure mode of
   * the brain button is "silence that looks like a broken button".
   * Docs: https://ai.google.dev/gemini-api/docs/generate-content/thinking
   */
  if (!msg.thinking) {
    return (
      <div className="chat-think empty">
        <span className="chat-think-head">
          <Brain size={12} strokeWidth={2.2} aria-hidden />
          <span>{t('ai.noThoughts')}</span>
        </span>
      </div>
    );
  }

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

export default function ChatPane({ deviceId, settings, caps, ai, addLog, onSource }) {
  const { t, lang } = useLang();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(false);
  const [thinking, setThinking] = useState(false);
  const bodyRef = useRef(null);
  const abortRef = useRef(null);
  /** A turn paused on "the on-device model is not downloaded yet — download it?" */
  const [ask, setAsk] = useState(null);
  const askRef = useRef(null);

  /**
   * The arranged chain, as attempts. An engine that fails hands the question to
   * the next one; the last one's failure is the turn's failure.
   */
  const chain = aiChainFrom(
    settings.aiOrder,
    // Nobody has arranged anything yet, which is the state every browser starts
    // in: follow the deployment's own order (self-hosted first, cloud behind it)
    // rather than treating "not arranged" as "nothing to try".
    ai?.kind === 'browser' ? ['browser'] : (caps?.order ?? [])
  );
  const runs = aiChainRuns(chain.filter((id) => id !== 'browser' || ai?.webgpu !== false));
  // Belt and braces: /api/config may not have answered yet, and a turn with no
  // attempts at all ends in an empty bubble — no answer and no error. One server
  // run with no order header lets the server decide, which is what it did before
  // the chain existed.
  if (!runs.length) runs.push({ kind: 'server', providers: [] });
  const onBrowser = runs[0].kind === 'browser';
  /** Weights already on this machine, so falling back costs a load, not a download. */
  const browserReady = ai?.status?.phase === 'cached' || ai?.status?.phase === 'ready';

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

  /**
   * One engine's go at the turn. Throws when it fails, which is how the caller
   * learns to try the next one. The server runs carry their own slice of the
   * chain as the order header, so [cloud, browser, local] really is three tries
   * in that order rather than "both server providers, then the browser".
   */
  const runAttempt = async (run, { msg, history, signal }, produced) => {
    const events =
      run.kind === 'browser'
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
            signal,
          })
        : chatEvents({
            url: `${settings.apiBase}/api/chat/stream`,
            headers: aiJsonHeaders({ ...settings, aiOrder: run.providers.join(',') }),
            body: {
              message: msg,
              history,
              device_id: deviceId,
              lang,
              search: search && canSearch,
              thinking,
            },
            signal,
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
          produced.any = true;
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
          produced.any = true;
          patchLast((m) => ({
            ...m,
            tools: m.tools.map((c) =>
              c.running && c.name === ev.name
                ? { ...c, running: false, ok: ev.ok, note: ev.note }
                : c
            ),
          }));
          break;
        // The server reports a dead chain this way rather than by failing the
        // stream, so it has to count as this engine's failure, not the turn's.
        case 'error':
          throw new Error(ev.message);
        default:
          break;
      }
    }
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
        // Remembered per message, because the toggle can be flipped mid-turn and
        // a finished answer has to be judged by what *it* was asked for.
        thinkAsked: thinking,
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
    const produced = { any: false };
    let failure = null;
    let ranServer = false;

    try {
      for (const [i, run] of runs.entries()) {
        if (controller.signal.aborted) break;
        if (run.kind === 'server' && !canStream) {
          failure = new Error('streaming disabled');
          continue;
        }

        // No model picked yet — there is no built-in one — so there is nothing
        // to offer to download. Say which setting fixes it and move on.
        if (run.kind === 'browser' && !ai?.modelId) {
          failure = new Error(t('bai.noModelWhere'));
          continue;
        }

        // Several gigabytes is not something to start on someone's behalf, so a
        // browser run whose weights are not on this machine yet asks first. The
        // answer resolves the promise the turn is waiting on: download and carry
        // on here, or hand the question to whatever is next in the chain.
        if (run.kind === 'browser' && !browserReady) {
          patchLast((m) => ({ ...m, status: null }));
          const choice = await new Promise((resolve) => {
            askRef.current = resolve;
            setAsk({ size: ai?.model?.sizeText, label: ai?.model?.label, resolve });
          });
          askRef.current = null;
          setAsk(null);
          if (choice !== 'download' || controller.signal.aborted) {
            failure = failure ?? new Error(t('bai.notDownloaded'));
            continue;
          }
          try {
            await ai.loadModel();
          } catch (e) {
            failure = e;
            continue;
          }
        }

        try {
          if (run.kind === 'server') ranServer = true;
          await runAttempt(run, { msg, history, signal: controller.signal }, produced);
          failure = null;
          break;
        } catch (e) {
          failure = e;
          if (controller.signal.aborted) break;
          // Half an answer is already on screen: starting again somewhere else
          // would rewrite what someone is reading, so this one keeps its failure.
          if (produced.any) break;
          addLog(`Chat ${run.kind === 'browser' ? 'browser' : run.providers.join(',')}: ${e.message}`, 'warn');
          // Announce the handover — a switch of engine explains a pause that
          // otherwise looks like the answer having stalled.
          if (i < runs.length - 1) patchLast((m) => ({ ...m, status: t('ai.tryingNext') }));
        }
      }

      if (controller.signal.aborted) {
        patchLast((m) => ({ ...m, error: produced.any ? null : t('ai.stopped') }));
      } else if (failure && !produced.any && ranServer) {
        // Nothing shipped and a server engine was in the chain, so the plain
        // endpoint can still answer this turn.
        addLog(`Chat stream failed, using /api/chat: ${failure.message}`, 'warn');
        try {
          const data = await sendPlain(msg, history, controller.signal);
          onSource?.(data);
          patchLast((m) => ({ ...m, content: data.reply ?? '—', status: null }));
        } catch (e2) {
          patchLast((m) => ({ ...m, error: e2.message, status: null }));
          addLog(`Chat error: ${e2.message}`, 'err');
        }
      } else if (failure) {
        patchLast((m) => ({ ...m, error: failure.message, status: null }));
        addLog(`Chat error: ${failure.message}`, 'err');
      }
    } finally {
      askRef.current = null;
      setAsk(null);
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
              {!onBrowser
                ? t('ai.chatEmpty2')
                : ai.model
                  ? t('bai.emptyHint', { model: ai.model.label })
                  : t('bai.noModelWhere')}
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role === 'user' ? 'user' : 'bot'}`}>
            {/* The empty-handed note waits for the turn to end — thoughts that
                arrive late are still thoughts — and stays out of the way when the
                turn failed, since the error already says what happened. */}
            {m.role === 'assistant' &&
              (m.thinking || (m.thinkAsked && !m.streaming && !m.error)) && (
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
            {/* The paused turn, waiting on a yes: the download is gigabytes, so
                it is offered rather than started. Either button resumes. */}
            {m.role === 'assistant' && m.streaming && ask && i === messages.length - 1 && (
              <div className="chat-ask">
                <p>{t('ai.askDownload', { model: ask.label ?? '', size: ask.size ?? '?' })}</p>
                <span className="chat-ask-acts">
                  <button className="chat-ask-go" onClick={() => ask.resolve('download')}>
                    {t('ai.askDownloadGo')}
                  </button>
                  <button onClick={() => ask.resolve('skip')}>{t('ai.askDownloadSkip')}</button>
                </span>
              </div>
            )}
            {m.role === 'user' ? (
              <div className="chat-bubble">{m.content}</div>
            ) : (
              // While a status line is showing there is nothing to put in a
              // bubble, and an empty one reads as a failed reply. A turn paused
              // on the download question is not typing either — the blinking
              // caret would claim an answer is on its way when it is waiting.
              (m.content || m.error || (m.streaming && !m.status && !ask)) && (
                <div className="chat-bubble">
                  {m.content ? (
                    <Markdown text={m.content} className="markdown chat-md" />
                  ) : (
                    m.streaming && !ask && <span className="chat-typing" aria-hidden />
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
          {/* Which engine answers is chosen in Settings, not here: the composer's
              buttons are per-question switches, and where the model runs is not
              one of those. Which one is answering shows in the title bar. */}
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
              // A turn paused on the download question is waiting on a promise,
              // not on the network: aborting alone would leave it hanging.
              askRef.current?.('skip');
              // The abort signal stops the loop reading chunks; WebLLM also has
              // to be told, or it keeps generating into nothing.
              if (chain.includes('browser')) void interruptBrowser();
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
