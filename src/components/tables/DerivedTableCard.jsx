'use client'
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Table as TableIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import TableGrid from './TableGrid';
import TableExportMenu from './TableExportMenu';
import tablesApi from '@/lib/tablesApi';

// A cross-document table built by compare_tables (FR-30, FR-31): every value
// links back to its source document/table/page; Change and Change % are
// computed in code. Rendered under the chat answer that produced it.
export default function DerivedTableCard({ derivedTableId, derived: initial = null, className }) {
  const router = useRouter();
  const [derived, setDerived] = useState(initial);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (initial || !derivedTableId) return;
    let cancelled = false;
    tablesApi.getDerivedTable(derivedTableId).then((res) => {
      if (cancelled) return;
      if (res?.success) setDerived(res.derived);
      else setError(res?.error || 'This comparison table is no longer available.');
    });
    return () => { cancelled = true; };
  }, [derivedTableId, initial]);

  const sources = useMemo(() => {
    if (!derived?.table) return [];
    const seen = new Map();
    for (const row of derived.table.rows) {
      for (const cell of row.cells) {
        const s = cell.src;
        if (s && !seen.has(`${s.documentId}:${s.tableId}`)) seen.set(`${s.documentId}:${s.tableId}`, s);
      }
    }
    return [...seen.values()];
  }, [derived]);

  if (error) {
    return <p className="mt-2 text-[11px] italic text-gray-400">{error}</p>;
  }
  if (!derived) {
    return <div className="mt-2 flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading table…</div>;
  }

  const id = derived.id || derivedTableId;
  return (
    <div className={cn('mt-2 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
            <TableIcon className="w-3.5 h-3.5 text-primary-500 shrink-0" />
            <span className="truncate">{derived.title}</span>
          </p>
          {derived.table.tableUnit && <p className="text-[11px] text-gray-500 ml-5">Units: {derived.table.tableUnit}</p>}
        </div>
        {id && <TableExportMenu onExport={(format) => tablesApi.exportDerivedTable(id, format)} />}
      </div>

      <TableGrid table={derived.table} maxHeight="22rem" dense />

      {derived.warnings?.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20 px-2.5 py-1.5 space-y-0.5">
          {derived.warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {w.message}
            </p>
          ))}
        </div>
      )}

      {sources.length > 0 && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>Sources:</span>
          {sources.map((s) => (
            <button
              key={`${s.documentId}:${s.tableId}`}
              onClick={() => router.push(`/document?id=${s.documentId}&tab=tables&table=${s.tableId}`)}
              className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-primary-50 hover:text-primary-700 dark:hover:bg-primary-900/30 transition-colors"
            >
              {s.documentName} · {s.tableTitle}{s.page ? ` (p. ${s.page})` : ''}
            </button>
          ))}
          <span className="text-gray-400">· Change columns are calculated.</span>
        </div>
      )}
    </div>
  );
}

// Chips for the tables an answer drew on (FR-28).
export function TableCitationChips({ citations }) {
  const router = useRouter();
  if (!Array.isArray(citations) || !citations.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {citations.map((c) => (
        <button
          key={c.tableId}
          onClick={() => router.push(`/document?id=${c.documentId}&tab=tables&table=${c.tableId}`)}
          title={c.documentName || undefined}
          className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-primary-300 hover:text-primary-700 transition-colors"
        >
          <TableIcon className="w-3 h-3" /> {c.title || 'Table'}{c.page ? ` · p. ${c.page}` : ''}
        </button>
      ))}
    </div>
  );
}
