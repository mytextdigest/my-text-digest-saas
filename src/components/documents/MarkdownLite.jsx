'use client'

// Minimal, dependency-free renderer for the handful of markdown constructs
// vision models tend to emit even when told "plain text only" (headings,
// bold, bullet/numbered lists). Not a general markdown parser — just enough
// to keep LLM-authored captions from showing raw ** and ### to the user.

function renderInline(text, keyPrefix) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

// For truncated previews (e.g. line-clamped excerpts) where block structure
// doesn't matter — just strip the syntax markers down to plain inline text.
export function stripMarkdown(text) {
  if (!text) return text;
  return text
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+[.)]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\n+/g, ' ')
    .trim();
}

export default function MarkdownLite({ text, className }) {
  if (!text) return null;

  const lines = text.split('\n');
  const blocks = [];
  let listBuffer = [];
  let listType = null; // 'ul' | 'ol'

  const flushList = (key) => {
    if (listBuffer.length === 0) return;
    const Tag = listType === 'ol' ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`list-${key}`} className={listType === 'ol' ? 'list-decimal pl-5 space-y-0.5' : 'list-disc pl-5 space-y-0.5'}>
        {listBuffer.map((item, i) => <li key={i}>{renderInline(item, `li-${key}-${i}`)}</li>)}
      </Tag>
    );
    listBuffer = [];
    listType = null;
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();

    if (!line) {
      flushList(idx);
      return;
    }

    const headingMatch = line.match(/^#{1,4}\s+(.*)$/);
    if (headingMatch) {
      flushList(idx);
      blocks.push(
        <p key={idx} className="font-semibold mt-2">{renderInline(headingMatch[1], `h-${idx}`)}</p>
      );
      return;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      if (listType !== 'ul') flushList(idx);
      listType = 'ul';
      listBuffer.push(bulletMatch[1]);
      return;
    }

    const numberedMatch = line.match(/^\d+[.)]\s+(.*)$/);
    if (numberedMatch) {
      if (listType !== 'ol') flushList(idx);
      listType = 'ol';
      listBuffer.push(numberedMatch[1]);
      return;
    }

    flushList(idx);
    blocks.push(<p key={idx}>{renderInline(line, `p-${idx}`)}</p>);
  });
  flushList('end');

  return <div className={className}>{blocks}</div>;
}
