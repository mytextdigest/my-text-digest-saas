'use client'
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GitCompare, Loader2, Search, Table as TableIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import DerivedTableCard from './DerivedTableCard';
import { pageLabel } from './tableFormat';
import tablesApi from '@/lib/tablesApi';

// Project-level Tables list (FR-38): search every extracted table across the
// project's documents; tick two or more to build a comparison table.
export default function ProjectTablesView({ projectId, className }) {
  const router = useRouter();
  const [tables, setTables] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]);
  const [comparing, setComparing] = useState(false);
  const [derived, setDerived] = useState(null);
  const [error, setError] = useState(null);

  const fetchTables = useCallback(async () => {
    const res = await tablesApi.listProjectTables(projectId, '');
    if (res?.success) setTables(res.tables);
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    fetchTables().finally(() => setLoading(false));
    const off = tablesApi.onTableExtractionUpdate?.(() => fetchTables());
    return () => off?.();
  }, [fetchTables]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => `${t.title || ''} ${t.description || ''} ${t.document_name}`.toLowerCase().includes(q));
  }, [tables, query]);

  const byDocument = useMemo(() => {
    const groups = new Map();
    for (const t of filtered) {
      if (!groups.has(t.document_id)) groups.set(t.document_id, { name: t.document_name, tables: [] });
      groups.get(t.document_id).tables.push(t);
    }
    return [...groups.entries()];
  }, [filtered]);

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const compare = async () => {
    setComparing(true);
    setError(null);
    try {
      const res = await tablesApi.compareTables(projectId, selected);
      if (res?.success) setDerived(res.derived);
      else setError(res?.error || 'Could not compare those tables.');
    } finally {
      setComparing(false);
    }
  };

  if (loading) {
    return <div className={cn('flex justify-center py-12', className)}><Loader2 className="w-6 h-6 text-gray-400 animate-spin" /></div>;
  }

  return (
    <div className={cn('flex flex-col gap-3 min-h-0', className)}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tables, e.g. revenue, headcount…"
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
        </div>
        <Button size="sm" onClick={compare} disabled={selected.length < 2} loading={comparing} className="flex items-center gap-1.5 text-white">
          <GitCompare className="h-3.5 w-3.5" /> Compare {selected.length >= 2 ? `(${selected.length})` : ''}
        </Button>
      </div>
      <p className="text-[11px] text-gray-400">
        {selected.length < 2 ? 'Tick two or more tables from different documents to compare them side by side.' : 'Values are copied from the documents; Change columns are calculated.'}
      </p>
      {error && <p className="text-xs text-red-500">{error}</p>}

      {derived && (
        <div className="relative">
          <button onClick={() => setDerived(null)} className="absolute right-2 top-4 z-10 p-1 rounded text-gray-400 hover:text-gray-700" title="Close"><X className="w-3.5 h-3.5" /></button>
          <DerivedTableCard derived={derived} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4">
        {!tables.length ? (
          <div className="flex flex-col items-center justify-center text-center py-12 space-y-2">
            <TableIcon className="h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No tables yet</p>
            <p className="text-xs text-gray-400 max-w-72">Tables are found automatically when PDF, Word and spreadsheet files are uploaded. For older documents, open a document and use Extract tables on its Tables tab.</p>
          </div>
        ) : !filtered.length ? (
          <p className="text-xs text-gray-500 py-6 text-center">No tables match “{query}”.</p>
        ) : byDocument.map(([docId, group]) => (
          <div key={docId}>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{group.name}</p>
            <div className="space-y-1">
              {group.tables.map((t) => (
                <div key={t.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.title}`} />
                  <button
                    onClick={() => router.push(`/document?id=${t.document_id}&tab=tables&table=${t.id}`)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="text-sm text-gray-900 dark:text-gray-100 truncate hover:text-primary-600">{t.title || 'Untitled table'}</p>
                    {t.description && <p className="text-[11px] text-gray-500 truncate">{t.description}</p>}
                  </button>
                  <span className="text-[10px] text-gray-400 shrink-0">{[pageLabel(t), `${t.row_count}×${t.col_count}`].filter(Boolean).join(' · ')}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
