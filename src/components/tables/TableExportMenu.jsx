'use client'
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

const FORMATS = [
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'csv', label: 'CSV' },
  { value: 'md', label: 'Markdown' },
  { value: 'json', label: 'JSON' },
];

// onExport(format) → promise of { success, canceled, error }
// onExportAll → optional, adds "All tables (one workbook)".
export default function TableExportMenu({ onExport, onExportAll, label = 'Export', size = 'sm' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const run = async (fn) => {
    setOpen(false);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fn();
      if (res?.success) setMessage('Saved');
      else if (res && !res.canceled) setMessage(res.error || 'Export failed');
    } finally {
      setBusy(false);
      setTimeout(() => setMessage(null), 2500);
    }
  };

  return (
    <div className="relative inline-flex items-center gap-2" ref={ref}>
      <Button
        size={size}
        variant="outline"
        onClick={() => (onExport ? setOpen((o) => !o) : run(onExportAll))}
        disabled={busy}
        className="flex items-center gap-1.5"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        {label}
        {onExport && <ChevronDown className="h-3 w-3" />}
      </Button>
      {message && <span className="text-[11px] text-gray-500">{message}</span>}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[12rem] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              onClick={() => run(() => onExport(f.value))}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {f.label}
            </button>
          ))}
          {onExportAll && (
            <>
              <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
              <button
                onClick={() => run(onExportAll)}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                All tables (one workbook)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
