'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Must cover the LONGER of the two keyframe durations in globals.css —
 * `num-in` (0.5s) outlasts `num-out` (0.3s), and tearing the animating markup
 * down early would cut the arriving figure's settle off mid-bounce.
 */
const SLIDE_MS = 500;

/**
 * Swaps a changed figure in with a slide: the outgoing characters rise,
 * shrinking and blurring away, while the incoming ones come up from below and
 * sharpen as they settle.
 *
 * Only the characters that actually changed move — 45.1 → 45.4 animates the
 * last digit alone and leaves "45." sitting still. Positions are matched from
 * the right so the decimals stay aligned when the integer part gains or loses a
 * digit (9.9 → 10.1 animates the "9" and the new leading "1", not every
 * column). Assumes the tabular figures every readout in this app already uses,
 * where each character occupies the same width.
 *
 * `value` is the rendered string, already formatted — callers keep their own
 * toFixed and their own "--" placeholder. Wrap the figure only: leave units,
 * labels and badges outside so nothing but the number itself moves.
 */
export default function SlidingNumber({ value, className = '' }) {
  const [current, setCurrent] = useState(value);
  const [previous, setPrevious] = useState(null);
  // What the last committed render put on screen. A ref rather than reading
  // `current`, so StrictMode's second pass sees the value already handled and
  // doesn't re-trigger the slide.
  const shown = useRef(value);

  useEffect(() => {
    if (shown.current === value) return;
    setPrevious(shown.current);
    setCurrent(value);
    shown.current = value;
  }, [value]);

  useEffect(() => {
    if (previous === null) return;
    // Drop the outgoing characters once their animation is done so they stop
    // taking part in layout and can't be picked up by assistive tech.
    const timer = setTimeout(() => setPrevious(null), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [previous, current]);

  return (
    <span className={`num-slide ${className}`.trim()}>
      {current.split('').map((char, i) => {
        // Right-aligned counterpart: undefined when the figure grew a digit.
        const before =
          previous === null ? char : previous[previous.length - (current.length - i)];
        if (before === char) {
          return <span key={i}>{char}</span>;
        }

        return (
          <span key={i} className="num-cell">
            {before !== undefined && (
              <span key={`out-${before}`} aria-hidden className="num-out">
                {before}
              </span>
            )}
            <span key={`in-${char}`} className="num-in">
              {char}
            </span>
          </span>
        );
      })}
    </span>
  );
}
