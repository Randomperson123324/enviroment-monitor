'use client';

import { Fragment } from 'react';

/**
 * Minimal markdown renderer for model output.
 *
 * Deliberately hand-rolled and element-based: the text comes from a language
 * model, so it must never reach dangerouslySetInnerHTML. Everything here
 * produces React nodes, which makes injection impossible by construction rather
 * than by sanitising. Covers what the models actually emit — bold, italic,
 * inline code, links, headings, and lists — and shows anything else verbatim.
 */

// Order matters: bold before italic, so ** isn't eaten as two single markers.
const INLINE_RE =
  /(\*\*|__)(.+?)\1|(\*|_)([^*_]+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Only http(s) links are clickable; anything else stays literal text. */
function safeHref(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Parse one line of inline markdown into React nodes. */
function inline(text, keyPrefix) {
  const nodes = [];
  let last = 0;
  let match;
  INLINE_RE.lastIndex = 0;

  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${match.index}`;

    if (match[2] != null) {
      nodes.push(<strong key={key}>{match[2]}</strong>);
    } else if (match[4] != null) {
      nodes.push(<em key={key}>{match[4]}</em>);
    } else if (match[5] != null) {
      nodes.push(<code key={key}>{match[5]}</code>);
    } else {
      const href = safeHref(match[7]);
      nodes.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {match[6]}
          </a>
        ) : (
          match[0]
        )
      );
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const HEADING_RE = /^(#{1,4})\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;

/** Group lines into blocks: headings, lists, and paragraphs. */
function toBlocks(text) {
  const blocks = [];
  let list = null;

  const closeList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      closeList();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    const ordered = !bullet && ORDERED_RE.exec(line);
    if (bullet || ordered) {
      const ordinal = Boolean(ordered);
      if (!list || list.ordered !== ordinal) {
        closeList();
        list = { type: 'list', ordered: ordinal, items: [] };
      }
      list.items.push((bullet ?? ordered)[1]);
      continue;
    }

    // Plain line: extend the open paragraph rather than starting a new one.
    closeList();
    const prev = blocks[blocks.length - 1];
    if (prev?.type === 'paragraph') prev.lines.push(line);
    else blocks.push({ type: 'paragraph', lines: [line] });
  }

  closeList();
  return blocks;
}

export default function Markdown({ text, className = 'markdown' }) {
  const blocks = toBlocks(text);
  if (!blocks.length) return null;

  return (
    <div className={className}>
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          const Tag = `h${Math.min(6, b.level + 2)}`;
          return <Tag key={i}>{inline(b.text, `h${i}`)}</Tag>;
        }
        if (b.type === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul';
          return (
            <Tag key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{inline(item, `l${i}-${j}`)}</li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {inline(line, `p${i}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
