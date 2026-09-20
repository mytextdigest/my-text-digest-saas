'use client'
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Loader2, Pencil, Check, Trash2, GitMerge, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TYPE_LABELS, styleForType } from './entityStyles';

// entityId: id to load detail for, or null when closed.
// mergeCandidates: optional [{id, name, type}] from the same project, used
// to render the "merge into another entity" control (project-level view
// only — a single document rarely has true duplicates to merge).
export default function EntityDetailModal({ entityId, mergeCandidates, onClose, onChanged }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [mentionsExpanded, setMentionsExpanded] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!entityId) {
      setData(null);
      return;
    }
    setLoading(true);
    setIsEditingName(false);
    setMentionsExpanded(false);
    setMergeTargetId('');
    fetch(`/api/entities/${entityId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((res) => { if (res?.success) setData(res); })
      .finally(() => setLoading(false));
  }, [entityId]);

  const open = !!entityId;
  const entity = data?.entity;

  const handleRename = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || !entity) { setIsEditingName(false); return; }
    setBusy(true);
    try {
      await fetch(`/api/entities/${entity.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      setData((d) => (d ? { ...d, entity: { ...d.entity, name: trimmed } } : d));
      setIsEditingName(false);
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!entity) return;
    setBusy(true);
    try {
      await fetch(`/api/entities/${entity.id}`, { method: 'DELETE', credentials: 'include' });
      onChanged?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleMerge = async () => {
    if (!entity || !mergeTargetId) return;
    setBusy(true);
    try {
      await fetch(`/api/entities/${entity.id}/merge`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeIntoId: mergeTargetId }),
      });
      onChanged?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const style = entity ? styleForType(entity.type) : null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-70 bg-black/30"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.2 }}
            className="fixed right-0 top-0 z-80 h-full w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-lg flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Entity</span>
              <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            {loading || !entity ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-6 w-6 text-gray-400 animate-spin" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                <div>
                  <span className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2 ${style.badge}`}>
                    {TYPE_LABELS[entity.type] || entity.type}
                  </span>
                  {isEditingName ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                        className="flex-1 text-lg font-semibold bg-transparent border-b border-gray-300 dark:border-gray-600 focus:outline-none focus:border-primary-500 text-gray-900 dark:text-gray-100"
                      />
                      <button onClick={handleRename} disabled={busy} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                        <Check className="h-4 w-4 text-emerald-600" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{entity.name}</h3>
                      <button
                        onClick={() => { setNameDraft(entity.name); setIsEditingName(true); }}
                        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Pencil className="h-3.5 w-3.5 text-gray-400" />
                      </button>
                    </div>
                  )}
                  {entity.value && (
                    <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {entity.value}{entity.unit || ''}
                      {entity.period && <span className="ml-2 text-sm font-normal text-gray-400">{entity.period}</span>}
                    </p>
                  )}
                  {entity.description && (
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{entity.description}</p>
                  )}
                  <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                    {entity.mention_count} mention{entity.mention_count === 1 ? '' : 's'} across {entity.document_count} document{entity.document_count === 1 ? '' : 's'}
                  </p>
                </div>

                {data.documents?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                      Appears in
                    </h4>
                    <ul className="space-y-1">
                      {data.documents.map((d) => (
                        <li key={d.id} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
                          <FileText className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                          <span className="truncate">{d.filename}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {data.edges?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                      Relationships
                    </h4>
                    <ul className="space-y-1.5">
                      {data.edges.map((edge) => {
                        const isSource = edge.source_entity_id === entity.id;
                        const other = isSource ? edge.target_name : edge.source_name;
                        return (
                          <li key={edge.id} className="text-sm text-gray-700 dark:text-gray-300">
                            {isSource ? (
                              <>
                                <span className="font-medium">{entity.name}</span>{' '}
                                <span className="text-gray-400">{edge.relation}</span>{' '}
                                <span className="font-medium">{other}</span>
                              </>
                            ) : (
                              <>
                                <span className="font-medium">{other}</span>{' '}
                                <span className="text-gray-400">{edge.relation}</span>{' '}
                                <span className="font-medium">{entity.name}</span>
                              </>
                            )}
                            {!!edge.is_inferred && (
                              <span className="ml-1.5 inline-block align-middle text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                                Insight
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {data.mentions?.length > 0 && (
                  <div>
                    <button
                      onClick={() => setMentionsExpanded((v) => !v)}
                      className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    >
                      {mentionsExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      Mentions ({data.mentions.length})
                    </button>
                    {mentionsExpanded && (
                      <ul className="mt-2 space-y-2">
                        {data.mentions.map((m) => (
                          <li key={m.id} className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 rounded-lg p-2">
                            <span className="font-medium text-gray-700 dark:text-gray-300">"{m.mention_text}"</span>
                            {' — '}{m.filename}{m.page_number != null ? `, page ${m.page_number}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {mergeCandidates?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                      Merge into another entity
                    </h4>
                    <div className="flex items-center gap-2">
                      <select
                        value={mergeTargetId}
                        onChange={(e) => setMergeTargetId(e.target.value)}
                        className="flex-1 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2 py-1.5"
                      >
                        <option value="">Select entity…</option>
                        {mergeCandidates.filter((c) => c.id !== entity.id).map((c) => (
                          <option key={c.id} value={c.id}>{c.name} ({TYPE_LABELS[c.type] || c.type})</option>
                        ))}
                      </select>
                      <Button size="sm" variant="outline" disabled={!mergeTargetId || busy} onClick={handleMerge} className="flex items-center gap-1.5 shrink-0">
                        <GitMerge className="h-3.5 w-3.5" /> Merge
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {entity && (
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
                <Button variant="destructive" size="sm" onClick={handleDelete} disabled={busy} className="flex items-center gap-2">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
