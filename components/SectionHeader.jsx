'use client';

/**
 * Uniform section header used by every dashboard section: icon + title on the
 * left, optional live-dot, optional controls (children), optional meta text.
 * One component so every section reads the same — no hand-rolled variants.
 */
export default function SectionHeader({ Icon, title, meta, live, children }) {
  return (
    <div className="sec-hdr">
      <span className="section-title">
        {live != null && <span className="live-dot" style={{ opacity: live ? 1 : 0.35 }} />}
        {Icon && <Icon size={19} strokeWidth={2.2} aria-hidden />}
        {title}
      </span>
      {children}
      {meta ? <span className="panel-meta sec-meta">{meta}</span> : null}
    </div>
  );
}
