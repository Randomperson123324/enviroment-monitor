'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_WINDOW, DESKTOP_MIN_WIDTH, STORAGE } from '@/config/client';

/**
 * Window behaviour for the assistant on desktop: docked to the right edge,
 * draggable out into a floating window, snapped back by dropping it near that
 * edge, and resizable in both modes.
 *
 * Below DESKTOP_MIN_WIDTH none of this applies — the hook reports `desktop:
 * false` and the panel stays the popover that grows out of its button, because
 * dragging a window around a phone screen is not a thing anyone wants.
 *
 * Pointer events with capture (not mouse events) so a drag keeps following the
 * finger/pen after it leaves the element, and so it cannot be lost by the
 * pointer crossing an iframe or leaving the window.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Keep a window reachable. A window that fits on screen is held fully inside it
 * (a half-off-screen chat box with its input below the fold is not a feature);
 * one taller or wider than the viewport is allowed to hang off, or its far edge
 * could never be reached.
 */
function clampToViewport({ x, y, w, h }) {
  const restX = window.innerWidth - w - 8;
  const restY = window.innerHeight - h - 8;
  return {
    w,
    h,
    x: clamp(x, Math.min(8, restX), Math.max(8, restX)),
    y: clamp(y, Math.min(8, restY), Math.max(8, restY)),
  };
}

const maxDockWidth = () => Math.round(window.innerWidth * AI_WINDOW.maxWidthRatio);

function defaultState() {
  return {
    mode: 'docked',
    dockWidth: AI_WINDOW.dockWidth,
    rect: { x: 0, y: 0, w: AI_WINDOW.floatWidth, h: AI_WINDOW.floatHeight },
  };
}

/** Persisted geometry is user data, but it is also untrusted input. */
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE.aiWindow) ?? 'null');
    if (!raw || typeof raw !== 'object') return defaultState();
    const base = defaultState();
    return {
      mode: raw.mode === 'floating' || raw.mode === 'full' ? raw.mode : 'docked',
      dockWidth: Number.isFinite(raw.dockWidth) ? raw.dockWidth : base.dockWidth,
      rect: {
        x: Number.isFinite(raw.rect?.x) ? raw.rect.x : base.rect.x,
        y: Number.isFinite(raw.rect?.y) ? raw.rect.y : base.rect.y,
        w: Number.isFinite(raw.rect?.w) ? raw.rect.w : base.rect.w,
        h: Number.isFinite(raw.rect?.h) ? raw.rect.h : base.rect.h,
      },
    };
  } catch {
    return defaultState();
  }
}

export default function useAiWindow(open) {
  const [desktop, setDesktop] = useState(false);
  const [state, setState] = useState(defaultState);
  /**
   * Which drop the current drag would perform, for the preview: 'dock' near the
   * right edge, 'full' when the window has been pulled most of the way across or
   * up against the top, null anywhere else. A word rather than a boolean, because
   * the preview has to show *which* shape is coming.
   */
  const [snapping, setSnapping] = useState(null);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef(null);
  const drag = useRef(null);

  // Restore after mount: localStorage is not available during SSR, and reading
  // it in useState would make the server and client markup disagree.
  useEffect(() => {
    setState(loadState());
    const mq = window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`);
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE.aiWindow, JSON.stringify(state));
  }, [state]);

  const docked = desktop && state.mode === 'docked';
  const full = desktop && state.mode === 'full';

  /**
   * What dropping here would do. Filling the screen wins over docking: the two
   * zones only meet in the top-right corner, and someone who has dragged the
   * window to the very top is asking for the big shape, not the narrow one.
   */
  const dropAt = (x, y) => {
    if (y < AI_WINDOW.topSnapZone) return 'full';
    if (x < window.innerWidth * (1 - AI_WINDOW.fullDragRatio)) return 'full';
    if (x > window.innerWidth - AI_WINDOW.snapZone) return 'dock';
    return null;
  };

  /**
   * The docked panel shares the screen with the page rather than covering it, so
   * the layout needs its width. Published as a custom property on <html> so the
   * shell and the floating button can react in CSS without the value being
   * threaded through every component between here and them.
   */
  useEffect(() => {
    const root = document.documentElement;

    const clear = () => {
      root.style.removeProperty('--ai-dock-w');
      delete root.dataset.aiDocked;
      delete root.dataset.railPeek;
    };

    if (!open || !docked) {
      clear();
      return clear;
    }

    /*
      Past a point the dashboard and a wide assistant cannot both be read, and the
      nav rail is what you need least while typing at the assistant. So it folds
      away to a strip you hover to bring back — the space goes to the content, and
      the strip is there so nobody has to guess where the nav went.
    */
    const apply = () => {
      root.style.setProperty('--ai-dock-w', `${state.dockWidth}px`);
      root.dataset.aiDocked = 'true';
      const contentWidth = window.innerWidth - state.dockWidth;
      if (contentWidth < AI_WINDOW.railPeekUnder) root.dataset.railPeek = 'true';
      else delete root.dataset.railPeek;
    };

    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      clear();
    };
  }, [open, docked, state.dockWidth]);

  /** Keep a floating window reachable when the viewport shrinks under it. */
  useEffect(() => {
    if (!desktop) return;
    const onResize = () =>
      setState((s) => {
        if (s.mode !== 'floating') return { ...s, dockWidth: clamp(s.dockWidth, AI_WINDOW.minWidth, maxDockWidth()) };
        return {
          ...s,
          rect: clampToViewport({
            x: s.rect.x,
            y: s.rect.y,
            w: clamp(s.rect.w, AI_WINDOW.minWidth, window.innerWidth - 16),
            h: clamp(s.rect.h, AI_WINDOW.minHeight, window.innerHeight - 16),
          }),
        };
      });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [desktop]);

  /** Shared pointer plumbing: capture, follow, release. */
  const beginDrag = useCallback(
    (e, handler) => {
      if (!desktop || e.button !== 0) return;
      e.preventDefault();
      // Throws when the pointer is no longer active (a release that raced the
      // handler, a synthetic event). Capture is an optimisation here — the panel
      // also listens for move/up — so losing it must not abort the drag.
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {}
      drag.current = handler;
      setBusy(true);
    },
    [desktop]
  );

  const onPointerMove = useCallback((e) => {
    drag.current?.move?.(e);
  }, []);

  const onPointerUp = useCallback((e) => {
    const handler = drag.current;
    drag.current = null;
    setBusy(false);
    setSnapping(null);
    handler?.end?.(e);
  }, []);

  /**
   * Dragging the title bar. A docked panel pops out into a floating window at
   * the size and place it already occupies, so it appears to detach rather than
   * jump — the same feel as pulling a snapped window off the edge in Windows.
   */
  const startMove = useCallback(
    (e) => {
      if (!desktop) return;
      /*
        A press on a control in the title bar is a click, not a drag. Without this
        the drag claimed pointer capture, and capture retargets the *click* to the
        capturing element — so the dock and close buttons never received it and
        looked broken.
      */
      if (e.target.closest?.('button, a, input, select, textarea')) return;

      const box = panelRef.current?.getBoundingClientRect();
      if (!box) return;
      const from = { x: e.clientX, y: e.clientY };
      let dragging = false;
      const size = {
        w:
          state.mode === 'floating'
            ? state.rect.w
            : clamp(
                state.mode === 'full' ? state.rect.w : box.width,
                AI_WINDOW.minWidth,
                maxDockWidth()
              ),
        h: clamp(
          state.mode === 'floating' ? box.height : state.rect.h,
          AI_WINDOW.minHeight,
          window.innerHeight - 16
        ),
      };
      /*
        Where the window sits under the cursor once it starts moving. A window
        filling the screen has no useful grab offset — the pointer could be a
        thousand pixels from where the restored window's title bar will be — so it
        is re-hung under the cursor in proportion, the way a maximised window
        behaves when you pull it down.
      */
      const offsetX = state.mode === 'full' ? size.w / 2 : e.clientX - box.left;
      const offsetY = state.mode === 'full' ? 18 : e.clientY - box.top;

      beginDrag(e, {
        move: (ev) => {
          // A mouse jitters a pixel or two on press; undocking on that would make
          // the window jump every time someone taps its title bar.
          if (!dragging) {
            if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < AI_WINDOW.dragThreshold) return;
            dragging = true;
          }
          // Snapping is decided by the pointer, not the window, so the window
          // itself never has to leave the screen to reach a zone.
          setSnapping(dropAt(ev.clientX, ev.clientY));
          setState((s) => ({
            ...s,
            mode: 'floating',
            rect: clampToViewport({ ...size, x: ev.clientX - offsetX, y: ev.clientY - offsetY }),
          }));
        },
        end: (ev) => {
          if (!dragging) return;
          const drop = dropAt(ev.clientX, ev.clientY);
          if (drop === 'full') {
            // The floating rect is kept as it was: it is what the window restores
            // to when it is dragged back off the edge.
            setState((s) => ({ ...s, mode: 'full' }));
          } else if (drop === 'dock') {
            setState((s) => ({ ...s, mode: 'docked', dockWidth: clamp(size.w, AI_WINDOW.minWidth, maxDockWidth()) }));
          }
        },
      });
    },
    [beginDrag, desktop, state.mode, state.rect.w, state.rect.h]
  );

  /**
   * Resize handles. `edge` is which side is being pulled: the docked panel only
   * offers 'left' (its other three sides are the screen), a floating window
   * offers left/right/bottom and the bottom-right corner.
   */
  const startResize = useCallback(
    (e, edge) => {
      if (!desktop) return;
      const box = panelRef.current?.getBoundingClientRect();
      if (!box) return;
      // `px/py` rather than `x/y`: the rect this used to be spread into also has
      // x/y, which silently overwrote the pointer's origin and made every delta
      // relative to the window's position instead of the grab point — pulling an
      // edge outward could shrink the window.
      const start = {
        px: e.clientX,
        py: e.clientY,
        left: box.left,
        width: box.width,
        height: box.height,
      };

      /**
       * Kept out of setState because the drop needs it after the last move, and
       * a state updater is not the place to read the pointer from.
       */
      let wantFull = false;

      beginDrag(e, {
        move: (ev) => {
          const dx = ev.clientX - start.px;
          const dy = ev.clientY - start.py;

          /*
            Where the edge is being asked to go, before the width cap has its say.
            The cap (maxWidthRatio) exists so a docked panel cannot squeeze the
            dashboard into a column — but pulling *well* past it is not a request
            for a slightly wider panel that the cap should quietly refuse. It is a
            request for the whole screen, and that is what a release now does.
          */
          const asked =
            edge.includes('right') && !docked ? start.width + dx : start.width - dx;
          wantFull = asked > window.innerWidth * AI_WINDOW.fullDragRatio;
          setSnapping(wantFull ? 'full' : null);

          setState((s) => {
            if (s.mode === 'docked') {
              // Pulling the left edge left widens the panel.
              return { ...s, dockWidth: clamp(start.width - dx, AI_WINDOW.minWidth, maxDockWidth()) };
            }
            const rect = { ...s.rect };
            if (edge.includes('left')) {
              const w = clamp(start.width - dx, AI_WINDOW.minWidth, window.innerWidth - 16);
              rect.x = start.left + (start.width - w);
              rect.w = w;
            }
            if (edge.includes('right')) {
              rect.w = clamp(start.width + dx, AI_WINDOW.minWidth, window.innerWidth - rect.x - 8);
            }
            if (edge.includes('bottom')) {
              rect.h = clamp(start.height + dy, AI_WINDOW.minHeight, window.innerHeight - rect.y - 8);
            }
            return { ...s, rect };
          });
        },
        end: () => {
          // The width it had before this pull is left alone, so leaving the full
          // screen returns it to the size it was, not to the cap.
          if (wantFull) setState((s) => ({ ...s, mode: 'full' }));
        },
      });
    },
    [beginDrag, desktop, docked]
  );

  const toggleDock = useCallback(() => {
    if (!desktop) return;
    setState((s) => {
      // Filling the screen is a third state the button has to be able to leave;
      // it returns to the edge, which is where the panel lives by default.
      if (s.mode === 'full') {
        return { ...s, mode: 'docked', dockWidth: clamp(s.dockWidth, AI_WINDOW.minWidth, maxDockWidth()) };
      }
      if (s.mode === 'docked') {
        const w = clamp(s.dockWidth, AI_WINDOW.minWidth, maxDockWidth());
        const h = clamp(s.rect.h, AI_WINDOW.minHeight, window.innerHeight - 96);
        return {
          ...s,
          mode: 'floating',
          // Offset from the edge it just left, so the change is visible.
          rect: clampToViewport({ w, h, x: window.innerWidth - w - 96, y: 96 }),
        };
      }
      return { ...s, mode: 'docked', dockWidth: clamp(s.rect.w, AI_WINDOW.minWidth, maxDockWidth()) };
    });
  }, [desktop]);

  return {
    desktop,
    docked,
    full,
    floating: desktop && state.mode === 'floating',
    dockWidth: state.dockWidth,
    rect: state.rect,
    snapping,
    busy,
    panelRef,
    startMove,
    startResize,
    toggleDock,
    onPointerMove,
    onPointerUp,
  };
}
