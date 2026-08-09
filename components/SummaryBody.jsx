'use client';

import Markdown from '@/components/Markdown';

/**
 * Renders one AI summary in the user's chosen style. Both styles read the same
 * generated payload — the choice is presentation only, so switching it costs no
 * model call and the server-side cache stays shared.
 *
 * blocks   — summary paragraph plus severity-coloured recommendation chips
 * markdown — one flowing document, with the model's own markdown honoured
 */
export default function SummaryBody({ summary, recommendations = [], style }) {
  if (style === 'markdown') {
    const bullets = recommendations.map((r) => `- ${r.text}`).join('\n');
    const doc = [summary, bullets].filter(Boolean).join('\n\n');
    return <Markdown text={doc} className="markdown ai-summary-text" />;
  }

  return (
    <>
      {summary ? <div className="ai-summary-text">{summary}</div> : null}
      <div className="reco-list">
        {recommendations.map((r, i) => (
          <div key={i} className={`reco ${r.level ?? 'info'}`}>
            {r.text}
          </div>
        ))}
      </div>
    </>
  );
}
