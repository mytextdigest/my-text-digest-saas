'use client'
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, ChevronRight, Image as ImageIcon, Loader2, RefreshCw, ScanLine, Table as TableIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import TableViewer from './TableViewer';
import TableExportMenu from './TableExportMenu';
import { confidenceLabel, isVisionTable, pageLabel } from './tableFormat';
import tablesApi from '@/lib/tablesApi';

// Document "Tables" tab (FR-36): "N tables found", the list, and one table
// at a time in TableViewer (the right-hand card is too narrow for both).
export default function TablesView({ docId, initialTableId = null, onAsk, onShowInDocument, onCountChange }) {
  const [tables, setTables] = useState([]);
  const [log, setLog] = useState(null);
  const [vision, setVision] = useState(null);
  const [progress, setProgress] = useState(null);
  const [confirmScan, setConfirmScan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(initialTableId ? initialTableId : null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  const fetchTables = useCallback(async () => {
    const res = await tablesApi.listTables(docId);
    if (res?.success) {
      setTables(res.tables);
      setLog(res.log);
      setVision(res.vision || null);
      onCountChange?.(res.tables.length);
    }
  }, [docId, onCountChange]);

  useEffect(() => {
    if (!docId) return;
    setLoading(true);
    fetchTables().finally(() => setLoading(false));
  }, [docId, fetchTables]);

  useEffect(() => {
    if (initialTableId) setSelectedId(initialTableId);
  }, [initialTableId]);

  useEffect(() => {
    const off = tablesApi.onTableExtractionUpdate?.(docId, (payload) => {
      if (String(payload?.docId) !== String(docId)) return;
      setProgress(payload.status === 'reading-images' ? { done: payload.done, total: payload.total } : null);
      if (payload.status !== 'reading-images') fetchTables();
    });
    return () => off?.();
  }, [docId, fetchTables]);

  const running = log?.status === 'running' || starting;

  const scanRemaining = async () => {
    setConfirmScan(false);
    setError(null);
    const res = await tablesApi.extractScannedTables(docId);
    if (!res?.success) setError(res?.error || 'Could not start reading the scanned pages.');
    await fetchTables();
  };

  const progressText = progress
    ? progress.total > 1
      ? `Reading images for tables (${Math.min(progress.done, progress.total)}/${progress.total})…`
      : 'Reading images for tables…'
    : null;

  // Scanned pages the automatic run skipped to keep costs down.
  const pendingBanner = !running && vision?.pendingPages > 0 && (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
      <ScanLine className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <div className="flex-1 space-y-1.5">
        <p>
          {vision.pendingPages} scanned page{vision.pendingPages === 1 ? ' hasn\'t' : 's haven\'t'} been checked for tables yet.
          {vision.enabled
            ? ` Reading them uses AI vision and costs up to about $${vision.estimatedCostUsd.toFixed(2)} (pages without tables are skipped for free).`
            : ' Reading tables from images is turned off in settings.'}
        </p>
        {vision.enabled && (confirmScan ? (
          <span className="flex items-center gap-1.5">
            <Button size="sm" onClick={scanRemaining} className="text-white">Check {vision.pendingPages} page{vision.pendingPages === 1 ? '' : 's'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmScan(false)}>Cancel</Button>
          </span>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setConfirmScan(true)}>Check remaining pages</Button>
        ))}
      </div>
    </div>
  );

  const extract = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await tablesApi.extractTables(docId);
      if (!res?.success) setError(res?.error || 'Could not start table extraction.');
      setSelectedId(null);
      await fetchTables();
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full py-12"><Loader2 className="w-6 h-6 text-gray-400 animate-spin" /></div>;
  }

  if (selectedId && tables.some((t) => t.id === selectedId)) {
    return (
      <TableViewer
        key={selectedId}
        tableId={selectedId}
        onBack={() => setSelectedId(null)}
        onDeleted={() => { setSelectedId(null); fetchTables(); }}
        onChanged={fetchTables}
        onAsk={onAsk}
        onShowInDocument={onShowInDocument}
      />
    );
  }

  if (!tables.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-12 space-y-3">
        {running ? (
          <>
            <Loader2 className="h-8 w-8 text-primary-500 animate-spin" />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{progressText || 'Looking for tables…'}</p>
          </>
        ) : (
          <>
            <TableIcon className="h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {log?.status === 'ready' ? 'No tables found' : log?.status === 'error' ? 'Table extraction failed' : 'Tables not extracted yet'}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 max-w-72">
              {log?.status === 'ready'
                ? "We didn't find any data tables in this document."
                : log?.status === 'error'
                  ? log.error_message
                  : 'Find every table in this document and turn it into data you can edit, export and compare.'}
            </p>
            <Button size="sm" onClick={extract} loading={starting} className="flex items-center gap-1.5 text-white">
              <TableIcon className="h-3.5 w-3.5" /> {log?.status === 'ready' ? 'Try again' : 'Extract tables'}
            </Button>
            {error && <p className="text-xs text-red-500">{error}</p>}
            {pendingBanner && <div className="max-w-sm text-left">{pendingBanner}</div>}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {tables.length} table{tables.length === 1 ? '' : 's'} found
          </p>
          {(running || progressText) && (
            <p className="text-[11px] text-gray-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> {progressText || 'Indexing tables for search and chat…'}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <TableExportMenu label="Export all" onExport={null} onExportAll={() => tablesApi.exportAllTables(docId)} />
          <Button size="sm" variant="ghost" onClick={extract} disabled={running} title="Run table extraction again (your edits are kept)" className="flex items-center gap-1.5 text-gray-500">
            <RefreshCw className={cn('h-3.5 w-3.5', running && 'animate-spin')} /> Re-extract
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {pendingBanner}

      <div className="space-y-1.5">
        {tables.map((t) => {
          const low = confidenceLabel(t.confidence);
          return (
            <motion.button
              key={t.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setSelectedId(t.id)}
              className="w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary-300 hover:shadow-sm transition-all"
            >
              <TableIcon className="w-4 h-4 text-primary-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                  <span className="text-gray-400 mr-1.5">Table {t.table_index + 1}</span>{t.title || 'Untitled table'}
                </p>
                {t.description && <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{t.description}</p>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
                {isVisionTable(t) && <ImageIcon className="w-3.5 h-3.5 text-gray-400" title="Read from an image" />}
                {t.edited && <span className="px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">Edited</span>}
                {low && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{low}</span>}
                {t.grounding_issues > 0 && <AlertCircle className="w-3.5 h-3.5 text-yellow-500" title="Some values need checking" />}
                {pageLabel(t) && <span className="text-gray-400">{pageLabel(t)}</span>}
                <span className="text-gray-400">{t.row_count}×{t.col_count}</span>
                <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
