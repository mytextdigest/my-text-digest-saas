'use client'
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, BarChart3, Check, ChevronDown, Copy, FileSearch, Image as ImageIcon, Loader2, MessageCircle, MoreHorizontal, Pencil, RotateCcw, Trash2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import TableGrid from './TableGrid';
import TableExportMenu from './TableExportMenu';
import TableChartPanel from './TableChartPanel';
import { VISION_SOURCES, confidenceLabel, isVisionTable, pageLabel, tableToEditable } from './tableFormat';
import tablesApi from '@/lib/tablesApi';

// Tables read from a picture: says so, and shows the picture for checking.
function VisionSourceNote({ record }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
      <div className="flex items-start gap-2">
        <ImageIcon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />
        <p className="flex-1">
          Read by AI from {VISION_SOURCES[record.source_type] === 'image' ? 'this image' : `a ${VISION_SOURCES[record.source_type]}`}.
          Every number was checked against the image's OCR text; values OCR couldn't confirm are underlined.
        </p>
        {record.sourceImageUrl && (
          <button onClick={() => setOpen((o) => !o)} className="shrink-0 flex items-center gap-0.5 text-primary-600 hover:underline">
            {open ? 'Hide image' : 'Show image'} <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && record.sourceImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={record.sourceImageUrl} alt="Source of this table" className="mt-2 max-h-96 w-full object-contain rounded border border-gray-200 dark:border-gray-700 bg-white" />
      )}
    </div>
  );
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="flex items-center gap-1 border border-gray-200 dark:border-gray-700 rounded-lg p-1 shrink-0">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          disabled={o.disabled}
          className={cn(
            'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded transition-colors disabled:opacity-40',
            value === o.value
              ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400'
              : 'text-gray-400 hover:text-gray-600'
          )}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

function CleanupMenu({ table, onAction, onReset, edited }) {
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const item = 'w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700';
  const firstRow = table?.rows?.[0];
  return (
    <div className="relative" ref={ref}>
      <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5">
        <MoreHorizontal className="h-3.5 w-3.5" /> Clean up
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-60 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1">
          <button className={item} onClick={() => { setOpen(false); onAction('transpose'); }}>Transpose rows and columns</button>
          {firstRow && (
            <button className={item} onClick={() => { setOpen(false); onAction('promoteRowToHeader', { rowId: firstRow.id }); }}>Use first row as header</button>
          )}
          {firstRow && (
            <button className={item} onClick={() => { setOpen(false); onAction('removeRows', { rowIds: [firstRow.id] }); }}>Remove first row</button>
          )}
          <div className="px-3 py-1.5 flex items-center gap-1.5">
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder={table?.tableUnit || 'Units, e.g. USD millions'}
              className="flex-1 min-w-0 text-xs px-1.5 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
            />
            <button className="text-xs text-primary-600 disabled:opacity-40" disabled={!unit.trim()} onClick={() => { setOpen(false); onAction('setUnit', { unit: unit.trim() }); setUnit(''); }}>Set</button>
          </div>
          {edited && (
            <>
              <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
              <button className={item} onClick={() => { setOpen(false); onReset(); }}>
                <span className="inline-flex items-center gap-1.5"><RotateCcw className="w-3 h-3" /> Reset to extracted version</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// One table: title/description (inline-editable), Clean/Raw/Analyze views,
// edit mode, export, copy, ask, show-in-document and delete (FR-12–25).
export default function TableViewer({ tableId, onBack, onDeleted, onAsk, onShowInDocument, onChanged }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('clean'); // clean | raw | analyze
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [titleDraft, setTitleDraft] = useState(null);
  const [descDraft, setDescDraft] = useState(null);
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    const res = await tablesApi.getTable(tableId);
    if (res?.success) { setRecord(res.table); setError(null); }
    else setError(res?.error || 'Could not load this table.');
  }, [tableId]);

  useEffect(() => { setEditing(false); setView('clean'); setStats(null); load(); }, [load]);

  useEffect(() => {
    if (view !== 'analyze' || !record) return;
    tablesApi.getTableStats(tableId).then((res) => res?.success && setStats(res.stats));
  }, [view, record, tableId]);

  if (error) return <p className="text-sm text-red-500 py-6 text-center">{error}</p>;
  if (!record) {
    return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 text-gray-400 animate-spin" /></div>;
  }

  const applyResult = (res) => {
    if (res?.success) { setRecord(res.table); onChanged?.(); setError(null); }
    else setError(res?.error || 'That change could not be applied.');
  };

  const startEdit = () => { setDraft(tableToEditable(record.effective)); setEditing(true); setView('clean'); };
  const saveEdit = async () => {
    setSaving(true);
    try { applyResult(await tablesApi.updateTable(tableId, { editedJson: draft })); setEditing(false); }
    finally { setSaving(false); }
  };
  const saveTitle = async () => {
    const patch = {};
    if (titleDraft != null && titleDraft.trim() && titleDraft !== record.title) patch.title = titleDraft.trim();
    if (descDraft != null && descDraft !== (record.description || '')) patch.description = descDraft;
    setTitleDraft(null); setDescDraft(null);
    if (Object.keys(patch).length) applyResult(await tablesApi.updateTable(tableId, patch));
  };
  const doAction = async (action, args) => applyResult(await tablesApi.applyTableAction(tableId, action, args));
  const doReset = async () => applyResult(await tablesApi.resetTable(tableId));
  const doCopy = async () => {
    const res = await tablesApi.copyTable(tableId);
    if (res?.success) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };
  const doDelete = async () => {
    const res = await tablesApi.deleteTable(tableId);
    if (res?.success) onDeleted?.(tableId);
  };

  const eff = record.effective;
  const lowConf = confidenceLabel(record.confidence);
  const where = pageLabel(record);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start gap-2">
        {onBack && (
          <button onClick={onBack} title="All tables" className="mt-0.5 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          {titleDraft != null ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setTitleDraft(null); }}
              className="w-full text-sm font-semibold px-1.5 py-0.5 rounded border border-primary-300 bg-white dark:bg-gray-900"
            />
          ) : (
            <button onClick={() => setTitleDraft(record.title || '')} className="group text-left" title="Rename">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Table {record.table_index + 1} · {record.title || 'Untitled table'}
              </span>
              <Pencil className="inline w-3 h-3 ml-1.5 text-gray-300 group-hover:text-gray-500" />
            </button>
          )}
          {descDraft != null ? (
            <textarea
              autoFocus
              rows={2}
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={saveTitle}
              className="mt-1 w-full text-xs px-1.5 py-1 rounded border border-primary-300 bg-white dark:bg-gray-900"
            />
          ) : (
            <p onClick={() => setDescDraft(record.description || '')} className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 cursor-text">
              {record.description || <span className="italic text-gray-400">Add a description</span>}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            {where && <span>{where}</span>}
            <span>· {eff.rows.length} × {eff.columns.length}</span>
            {eff.tableUnit && <span>· Units: {eff.tableUnit}</span>}
            {record.edited && <span className="px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">Edited</span>}
            {lowConf && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" title="The layout was hard to read — check the values against the document.">{lowConf}</span>}
            {record.raw?.truncated && <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">First {eff.rows.length} of {record.raw.totalRows} rows</span>}
          </div>
        </div>
      </div>

      {isVisionTable(record) && <VisionSourceNote record={record} />}

      {record.grounding_issues > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
          {record.grounding_issues} value{record.grounding_issues === 1 ? '' : 's'} could not be matched to {isVisionTable(record) ? 'the OCR text of the image' : 'the document text'} and {record.grounding_issues === 1 ? 'is' : 'are'} underlined. Check {record.grounding_issues === 1 ? 'it' : 'them'} before relying on this table.
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={(v) => { if (!editing) setView(v); }}
          options={[
            { value: 'clean', label: 'Table' },
            { value: 'raw', label: 'As extracted', disabled: editing },
            { value: 'analyze', label: 'Analyze', icon: <BarChart3 className="w-3.5 h-3.5" />, disabled: editing },
          ]}
        />
        <div className="flex-1" />
        {editing ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="flex items-center gap-1.5"><X className="h-3.5 w-3.5" /> Cancel</Button>
            <Button size="sm" onClick={saveEdit} loading={saving} className="flex items-center gap-1.5 text-white"><Check className="h-3.5 w-3.5" /> Save</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={startEdit} className="flex items-center gap-1.5"><Pencil className="h-3.5 w-3.5" /> Edit</Button>
            <CleanupMenu table={eff} edited={record.edited} onAction={doAction} onReset={doReset} />
            <TableExportMenu onExport={(format) => tablesApi.exportTable(tableId, format)} />
            <Button size="sm" variant="ghost" onClick={doCopy} title="Copy as tab-separated values (pastes into Excel or Sheets)" className="flex items-center gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />} Copy
            </Button>
            {onAsk && (
              <Button size="sm" variant="ghost" onClick={() => onAsk(record)} className="flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> Ask</Button>
            )}
            {onShowInDocument && record.page_start != null && (
              <Button size="sm" variant="ghost" onClick={() => onShowInDocument(record)} className="flex items-center gap-1.5"><FileSearch className="h-3.5 w-3.5" /> Show in document</Button>
            )}
            {confirmDelete ? (
              <span className="flex items-center gap-1 text-xs">
                <span className="text-gray-500">Delete?</span>
                <Button size="sm" variant="destructive" onClick={doDelete}>Delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} title="Not a real table? Remove it." className="text-gray-500 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </>
        )}
      </div>

      {view === 'raw' ? (
        <TableGrid table={record.raw} layer="raw" />
      ) : view === 'analyze' ? (
        <TableChartPanel table={eff} title={record.title} stats={stats} />
      ) : editing ? (
        <TableGrid table={draft} editable onChange={setDraft} />
      ) : (
        <TableGrid table={eff} />
      )}

      {Array.isArray(eff.notes) && eff.notes.some((n) => n.text) && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400 space-y-0.5">
          {eff.notes.filter((n) => n.text).map((n, i) => <p key={i}>{n.marker ? `(${n.marker}) ` : ''}{n.text}</p>)}
        </div>
      )}
      {record.caption && record.title_source !== 'caption' && (
        <p className="text-[11px] text-gray-400">Caption: {record.caption}</p>
      )}
    </div>
  );
}
