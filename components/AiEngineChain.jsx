'use client';

/**
 * Which AI answers, and in what order.
 *
 * Two controls over one piece of state, because there are two kinds of user
 * here. The buttons are the whole answer for someone who wants one engine and
 * nothing else — tap Cloud, done. The lane below is for arranging a fallback:
 * left to right is the order things are tried, and an engine dragged out of the
 * lane is simply not used. A lane can hold one box or all three, but never zero:
 * something has to answer.
 *
 * The arrows are not decoration. HTML5 drag-and-drop does not fire on touch at
 * all, so on a phone they are the only way to reorder, and they are also what
 * makes the lane usable from the keyboard.
 */

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Cloud, Cpu, MonitorSmartphone, Plus, X } from 'lucide-react';
import { AI_ENGINES } from '@/config/client';
import { useLang } from '@/hooks/useLang';

const ICONS = { gemini: Cloud, local: Cpu, browser: MonitorSmartphone };

export default function AiEngineChain({ chain, onChange, browserAi }) {
  const { t } = useLang();
  const [dragging, setDragging] = useState(null);

  // WebGPU missing means the browser box can be shown but never chosen: the
  // machine cannot run it, and a lane holding it would fail on every question.
  const disabled = (id) => id === 'browser' && browserAi?.webgpu === false;
  const unused = AI_ENGINES.filter((id) => !chain.includes(id));

  const set = (next) => {
    // Never empty, and never a lane whose first entry cannot run.
    if (!next.length) return;
    onChange(next);
  };

  const move = (id, delta) => {
    const from = chain.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= chain.length) return;
    const next = [...chain];
    next.splice(to, 0, ...next.splice(from, 1));
    set(next);
  };

  const remove = (id) => set(chain.filter((x) => x !== id));
  const add = (id) => set([...chain, id]);

  /** Drop `dragging` in front of `id`, or at the end when id is null. */
  const dropAt = (id) => {
    if (!dragging || disabled(dragging)) return;
    const rest = chain.filter((x) => x !== dragging);
    const at = id ? rest.indexOf(id) : rest.length;
    rest.splice(at < 0 ? rest.length : at, 0, dragging);
    set(rest);
    setDragging(null);
  };

  const Box = ({ id, index }) => {
    const Icon = ICONS[id];
    const off = disabled(id);
    return (
      <div
        className={`ai-chain-box ${off ? 'off' : ''} ${dragging === id ? 'dragging' : ''}`}
        draggable={!off}
        onDragStart={() => setDragging(id)}
        onDragEnd={() => setDragging(null)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dropAt(id);
        }}
      >
        <span className="ai-chain-rank">{index + 1}</span>
        <Icon size={15} strokeWidth={2.1} aria-hidden />
        <span className="ai-chain-name">{t(`settings.engine.${id}`)}</span>
        <span className="ai-chain-acts">
          <button
            type="button"
            onClick={() => move(id, -1)}
            disabled={index === 0}
            aria-label={t('settings.engineEarlier')}
            title={t('settings.engineEarlier')}
          >
            <ArrowLeft size={13} strokeWidth={2.4} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => move(id, 1)}
            disabled={index === chain.length - 1}
            aria-label={t('settings.engineLater')}
            title={t('settings.engineLater')}
          >
            <ArrowRight size={13} strokeWidth={2.4} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => remove(id)}
            // The last box has nowhere to go: removing it would leave nothing to
            // answer, so it stays until another engine is added.
            disabled={chain.length === 1}
            aria-label={t('settings.engineDrop')}
            title={t('settings.engineDrop')}
          >
            <X size={13} strokeWidth={2.4} aria-hidden />
          </button>
        </span>
      </div>
    );
  };

  return (
    <div className="ai-chain">
      <div className="ai-chain-pick" role="group" aria-label={t('settings.enginePick')}>
        {AI_ENGINES.map((id) => {
          const Icon = ICONS[id];
          const off = disabled(id);
          return (
            <button
              key={id}
              type="button"
              className={`ai-chain-btn ${chain[0] === id ? 'on' : ''}`}
              disabled={off}
              // The simple path: this one, on its own. Arranging a fallback is
              // what the lane is for.
              onClick={() => set([id])}
              title={off ? t('bai.noWebgpu') : t(`settings.engineHint.${id}`)}
              aria-pressed={chain[0] === id}
            >
              <Icon size={18} strokeWidth={2} aria-hidden />
              <span>{t(`settings.engine.${id}`)}</span>
            </button>
          );
        })}
      </div>
      <p className="field-hint">{t(`settings.engineHint.${chain[0] ?? 'gemini'}`)}</p>

      <label className="ai-chain-label">{t('settings.enginePriority')}</label>
      <div
        className="ai-chain-lane"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          dropAt(null);
        }}
      >
        {chain.map((id, i) => (
          <Box key={id} id={id} index={i} />
        ))}
      </div>

      {unused.length > 0 && (
        <>
          <p className="ai-chain-tray-label">{t('settings.engineUnused')}</p>
          <div
            className="ai-chain-lane tray"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              // Dropping into the tray is how an engine leaves the chain.
              if (dragging && chain.length > 1) remove(dragging);
              setDragging(null);
            }}
          >
            {unused.map((id) => {
              const Icon = ICONS[id];
              const off = disabled(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`ai-chain-box add ${off ? 'off' : ''}`}
                  disabled={off}
                  draggable={!off}
                  onDragStart={() => setDragging(id)}
                  onDragEnd={() => setDragging(null)}
                  onClick={() => add(id)}
                  title={off ? t('bai.noWebgpu') : t('settings.engineAdd')}
                >
                  <Plus size={13} strokeWidth={2.4} aria-hidden />
                  <Icon size={15} strokeWidth={2.1} aria-hidden />
                  <span className="ai-chain-name">{t(`settings.engine.${id}`)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <p className="field-hint">
        {chain.length > 1 ? t('settings.engineChainHint') : t('settings.engineOneHint')}
      </p>
      {chain.includes('browser') && (
        <p className="field-hint">{t('settings.engineBrowserNote')}</p>
      )}
    </div>
  );
}
