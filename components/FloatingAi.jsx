'use client';

import { useEffect, useState } from 'react';
import { Bot, Settings, X, PanelRight, PictureInPicture2 } from 'lucide-react';
import { aiChainFrom } from '@/config/client';
import { useLang } from '@/hooks/useLang';
import useAiWindow from '@/hooks/useAiWindow';
import ChatPane from '@/components/ChatPane';
import SettingsForm from '@/components/SettingsForm';

/** "gemma4-e4b (via relay)" — what actually answered, not what's configured. */
function sourceLabel(t, res) {
  if (!res?.provider) return '';
  // No model ran: the rule engine in lib/analysis.js replied.
  const name = res.provider === 'local-rules' ? t('ai.srcLocal') : res.model || res.provider;
  return res.via === 'relay' ? t('ai.viaRelay', { name }) : name;
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
export default function FloatingAi({
  deviceId,
  settings,
  serverCfg,
  serverAi,
  aiCaps,
  browserAi,
  addLog,
  onSaveSettings,
  initialView = 'chat',
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(initialView === 'settings');
  /** Kept mounted for the collapse animation, then dropped. */
  const [closing, setClosing] = useState(false);
  const [lastSource, setLastSource] = useState(null);
  /**
   * 'chat' | 'settings' — one at a time, swapped by the tabs in the title bar.
   * Settings live here rather than on their own screen because they are about
   * the thing in this panel: which AI answers, on what model. Showing both at
   * once would halve a dock that is already narrow.
   */
  const [view, setView] = useState(initialView);

  // The "/" shortcut lives in Dashboard (one global key listener for the app) and
  // reaches the assistant through this event, so the panel keeps owning its own
  // open state instead of having it lifted into the page for one keystroke.
  useEffect(() => {
    const openPanel = (e) => {
      setClosing(false);
      setOpen(true);
      if (e.detail?.view) setView(e.detail.view);
    };
    window.addEventListener('env-monitor:open-ai', openPanel);
    return () => window.removeEventListener('env-monitor:open-ai', openPanel);
  }, []);

  // The rail's button is the only one on screen at desktop widths, so it has to
  // do both jobs the floating button did. "/" keeps opening rather than toggling:
  // a shortcut that closes the panel you just asked for is a trap.
  useEffect(() => {
    const onToggle = () => toggle();
    window.addEventListener('env-monitor:toggle-ai', onToggle);
    return () => window.removeEventListener('env-monitor:toggle-ai', onToggle);
  });

  // The sidebar's assistant button mirrors this, and it cannot read state it does
  // not own. Announcing it keeps the rail in step without lifting `open` into the
  // page for one highlight.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('env-monitor:ai-state', { detail: { open: open && !closing } })
    );
  }, [open, closing]);

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

  // Until something answers we can only name the chain that will be tried — the
  // arranged one when there is one, since that is what the next question will
  // actually walk, and the server's own order otherwise.
  const planned = aiChainFrom(settings.aiOrder, serverAi ?? []);
  const source =
    sourceLabel(t, lastSource) ||
    (planned.length ? planned.map((id) => t(`settings.engine.${id}`)).join(' → ') : t('ai.local'));

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
            {/* Two faces of one panel. The tabs replace the old fixed title: it
                said "AI assistant" over a settings form otherwise. */}
            <div className="ai-tabs" role="tablist" aria-label={t('ai.title')}>
              <button
                role="tab"
                aria-selected={view === 'chat'}
                className={`ai-tab ${view === 'chat' ? 'on' : ''}`}
                onClick={() => setView('chat')}
                // The bar is the window's drag handle, and a drag that starts on
                // a tab must move the window, not select text in the label.
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Bot size={15} strokeWidth={2.2} aria-hidden />
                <span>{t('ai.title')}</span>
              </button>
              <button
                role="tab"
                aria-selected={view === 'settings'}
                className={`ai-tab ${view === 'settings' ? 'on' : ''}`}
                onClick={() => setView('settings')}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Settings size={15} strokeWidth={2.2} aria-hidden />
                <span>{t('settings.title')}</span>
              </button>
            </div>
            {view === 'chat' && <span className="src-tag">{source}</span>}
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

          {view === 'chat' ? (
            <ChatPane
              deviceId={deviceId}
              settings={settings}
              caps={aiCaps}
              ai={browserAi}
              addLog={addLog}
              onSource={setLastSource}
            />
          ) : (
            <SettingsForm
              scope="user"
              settings={settings}
              serverCfg={serverCfg}
              browserAi={browserAi}
              onSave={(patch) => {
                onSaveSettings?.(patch);
                // Back to the conversation: the settings were opened to change
                // something about it, and saving is the end of that errand.
                setView('chat');
              }}
              onClose={() => setView('chat')}
            />
          )}

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
