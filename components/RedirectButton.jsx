'use client';

import { ArrowUpRight } from 'lucide-react';

/**
 * External-link pill ported from StreeFlood's site footer: on hover the
 * arrow exits toward its pointing direction (top-right) while a twin
 * slides in from the bottom-left — the icon appears to fly off and loop
 * around. Same 0.3s cubic-bezier(0.15,0,0.3,1) motion as the original.
 */
export default function RedirectButton({ href, children }) {
  if (!href) return null;
  return (
    <a className="redirect-btn" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="redirect-arrow" aria-hidden>
        <ArrowUpRight size={14} strokeWidth={2.4} className="redirect-arrow-a" />
        <ArrowUpRight size={14} strokeWidth={2.4} className="redirect-arrow-b" />
      </span>
    </a>
  );
}
