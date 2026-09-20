"use client";
// src/components/insights/InsightView.jsx
// Shared renderer for the {sections:[{heading,body,bullets,quote,table,diagram}]}
// JSON shape produced by src/lib/compareInsight.js (Document Comparison) and,
// per MINOR_FEATURE_GAPS_FEATURE_SPEC.md, chat's Deep Analysis Mode. The
// model never outputs markdown — it outputs data — so this renders real HTML
// headings/lists/tables instead of parsing text, which is what keeps the
// result clean regardless of which pipeline produced it.
//
// Ported verbatim from the desktop app's src/components/insights/InsightView.jsx.
import { cn } from '@/lib/utils';

// Text-size tiers for the expanded-message modal's size picker. "md" is
// exactly the previous hardcoded sizes (text-base heading / text-sm body /
// text-xs table / text-[11px] diagram), so any caller that doesn't pass
// textSize renders identically to before this was added.
const SIZE_SCALE = {
  sm: { heading: 'text-sm', body: 'text-xs', table: 'text-[10px]', diagram: 'text-[10px]' },
  md: { heading: 'text-base', body: 'text-sm', table: 'text-xs', diagram: 'text-[11px]' },
  lg: { heading: 'text-lg', body: 'text-base', table: 'text-sm', diagram: 'text-xs' },
  xl: { heading: 'text-xl', body: 'text-lg', table: 'text-base', diagram: 'text-sm' },
};

function InsightTable({ table, columns, documentAName, documentBName, size }) {
  if (!table?.rows?.length) return null;
  const [labelA, labelB] = columns || [documentAName || 'Document A', documentBName || 'Document B'];
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 mb-2">
      <table className={cn('w-full', size.table)}>
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800/60">
            <th className="text-left font-medium text-gray-500 dark:text-gray-400 px-3 py-2 w-1/4"></th>
            <th className="text-left font-semibold text-gray-700 dark:text-gray-200 px-3 py-2 border-l border-gray-200 dark:border-gray-700 truncate">{labelA}</th>
            <th className="text-left font-semibold text-gray-700 dark:text-gray-200 px-3 py-2 border-l border-gray-200 dark:border-gray-700 truncate">{labelB}</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
              <td className="align-top font-medium text-gray-500 dark:text-gray-400 px-3 py-2">{r.label}</td>
              <td className="align-top text-gray-700 dark:text-gray-300 px-3 py-2 border-l border-gray-100 dark:border-gray-800">{r.a || '—'}</td>
              <td className="align-top text-gray-700 dark:text-gray-300 px-3 py-2 border-l border-gray-100 dark:border-gray-800">{r.b || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InsightDiagram({ diagram, size }) {
  if (!diagram) return null;
  return (
    <pre className={cn('mb-2 max-w-full overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/60 px-3 py-2 leading-snug text-gray-600 dark:text-gray-300 font-mono whitespace-pre', size.diagram)}>
      {diagram}
    </pre>
  );
}

// Strips wrapping quote marks the model sometimes includes inside the quote
// text itself (it's quoting a passage that was already in quotes in the
// source) — without this, the “ ” this component adds below stacks on top
// of the model's own, producing a visible """double-quoted""" mess.
function stripOuterQuotes(text) {
  return text.replace(/^["'“”‘’]+/, '').replace(/["'“”‘’]+$/, '').trim();
}

// dividers=true (Document Comparison's Insight tab) draws a horizontal rule
// between sections. dividers=false (chat's analysis/insight rendering) uses
// plain spacing instead — a border-line-per-section reads too much like a
// generic ChatGPT-style "---" report break.
export function InsightView({ insight, emptyHint, columns, documentAName, documentBName, dividers = true, textSize = 'md' }) {
  const sections = insight?.sections || [];
  const size = SIZE_SCALE[textSize] || SIZE_SCALE.md;
  if (sections.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">{emptyHint}</div>
    );
  }
  return (
    // min-w-0 is load-bearing here: this sits inside a flex row (the chat
    // bubble), and a flex item's default min-width:auto lets it grow to fit
    // its widest child (an unwrapped diagram line) instead of wrapping —
    // without this the whole bubble pushes past the viewport and gets
    // clipped by an ancestor's overflow instead of wrapping/scrolling.
    <div className="min-w-0 max-w-full">
      {sections.map((s, i) => (
        <div key={i} className={cn('min-w-0 max-w-full', i > 0 && (dividers ? 'pt-4 mt-4 border-t border-gray-100 dark:border-gray-800' : 'pt-3 mt-3'))}>
          {s.heading && (
            <h4 className={cn('font-semibold text-gray-900 dark:text-gray-100 mb-2 break-words overflow-wrap-anywhere', size.heading)}>{s.heading}</h4>
          )}
          {s.body && (
            <p className={cn('text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line break-words overflow-wrap-anywhere mb-2', size.body)}>{s.body}</p>
          )}
          {s.quote && (
            <blockquote className={cn('border-l-2 border-gray-300 dark:border-gray-600 pl-3 mb-2 italic text-gray-500 dark:text-gray-400 break-words overflow-wrap-anywhere', size.body)}>
              “{stripOuterQuotes(s.quote)}”
            </blockquote>
          )}
          {s.bullets?.length > 0 && (
            <ul className="space-y-1.5 mb-2">
              {s.bullets.map((b, j) => (
                <li key={j} className={cn('flex items-start gap-2 text-gray-600 dark:text-gray-300 leading-relaxed', size.body)}>
                  <span className="text-gray-400 dark:text-gray-600 mt-1 shrink-0">•</span>
                  <span className="min-w-0 break-words overflow-wrap-anywhere">{b}</span>
                </li>
              ))}
            </ul>
          )}
          <InsightDiagram diagram={s.diagram} size={size} />
          <InsightTable table={s.table} columns={columns} documentAName={documentAName} documentBName={documentBName} size={size} />
        </div>
      ))}
    </div>
  );
}

export default InsightView;
