'use client'
import { useState } from 'react';
import { ChevronDown, ChevronRight, Table as TableIcon } from 'lucide-react';
import DerivedTableCard from './DerivedTableCard';

// AI Document Comparison → Tables (FR-32): the two documents' matching
// tables side by side with exact value changes.
export default function TablePairsView({ tablePairs, documentAName, documentBName }) {
  const [open, setOpen] = useState(() => new Set([0]));
  const pairs = tablePairs?.pairs || [];

  if (!pairs.length) {
    return <p className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center">No matching tables were found in these two documents.</p>;
  }

  const toggle = (i) => setOpen((s) => {
    const next = new Set(s);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  return (
    <div className="space-y-3">
      {pairs.map((p, i) => {
        const isOpen = open.has(i);
        const changes = p.summary?.topChanges || [];
        return (
          <div key={`${p.tableA.id}-${p.tableB.id}`} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <button onClick={() => toggle(i)} className="w-full flex items-start gap-2 text-left px-4 py-3">
              {isOpen ? <ChevronDown className="w-4 h-4 mt-0.5 text-gray-400" /> : <ChevronRight className="w-4 h-4 mt-0.5 text-gray-400" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                  <TableIcon className="w-3.5 h-3.5 text-primary-500" />
                  {p.tableB.title === p.tableA.title ? p.tableA.title : `${p.tableA.title} ↔ ${p.tableB.title}`}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {documentAName}{p.tableA.page ? ` p. ${p.tableA.page}` : ''} · {documentBName}{p.tableB.page ? ` p. ${p.tableB.page}` : ''}
                </p>
                {!isOpen && changes.length > 0 && (
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 truncate">
                    {changes.slice(0, 3).map((c) => `${c.label} ${c.changePct}`).join(' · ')}
                  </p>
                )}
              </div>
            </button>
            {isOpen && (
              <div className="px-4 pb-4 space-y-2">
                {(p.summary?.onlyInA?.length > 0 || p.summary?.onlyInB?.length > 0) && (
                  <div className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                    {p.summary.onlyInB.length > 0 && <p><span className="font-medium text-green-700 dark:text-green-400">Added in {documentBName}:</span> {p.summary.onlyInB.join(', ')}</p>}
                    {p.summary.onlyInA.length > 0 && <p><span className="font-medium text-red-700 dark:text-red-400">Only in {documentAName}:</span> {p.summary.onlyInA.join(', ')}</p>}
                  </div>
                )}
                {p.derived ? <DerivedTableCard derived={p.derived} /> : <p className="text-xs text-gray-500">These tables could not be lined up automatically.</p>}
              </div>
            )}
          </div>
        );
      })}
      {(tablePairs.unpairedA?.length > 0 || tablePairs.unpairedB?.length > 0) && (
        <p className="text-[11px] text-gray-400">
          Tables without a counterpart: {[...(tablePairs.unpairedA || []).map((t) => `${t.title} (${documentAName})`), ...(tablePairs.unpairedB || []).map((t) => `${t.title} (${documentBName})`)].join('; ')}
        </p>
      )}
    </div>
  );
}
