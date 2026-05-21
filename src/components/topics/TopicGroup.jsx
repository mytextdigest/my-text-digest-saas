'use client'
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Pencil, Check, X, Trash2, FolderOpen, Sparkles, Loader2 } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import DocumentCard from '@/components/documents/DocumentCard';
import DraggableDocumentRow from './DraggableDocumentRow';
import { cn } from '@/lib/utils';

export default function TopicGroup({
  topic,
  documents = [],
  projectId,
  showLabels = true,
  onTopicRenamed,
  onTopicDeleted,
  onReclusterUnassigned,
  onView,
  onDelete,
  onToggleStar,
  onToggleSelect,
  onRename,
  defaultExpanded = true,
}) {
  const [expanded, setExpanded]             = useState(defaultExpanded);
  const [renaming, setRenaming]             = useState(false);
  const [nameValue, setNameValue]           = useState(topic.name);
  const [saving, setSaving]                 = useState(false);
  const [isReclustering, setIsReclustering] = useState(false);
  const inputRef = useRef(null);

  const droppableId = topic.id ?? 'unassigned';
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: droppableId });

  useEffect(() => { setNameValue(topic.name); }, [topic.name]);
  useEffect(() => { if (renaming) inputRef.current?.focus(); }, [renaming]);

  const startRename = (e) => {
    e.stopPropagation();
    setNameValue(topic.name);
    setRenaming(true);
  };

  const cancelRename = (e) => {
    e?.stopPropagation();
    setNameValue(topic.name);
    setRenaming(false);
  };

  const saveRename = async (e) => {
    e?.stopPropagation();
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === topic.name) { cancelRename(); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/topics/${topic.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        onTopicRenamed?.(topic.id, trimmed);
      } else {
        console.error('Failed to rename topic');
      }
    } catch (err) {
      console.error('Failed to rename topic:', err);
    } finally {
      setSaving(false);
      setRenaming(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter')  saveRename(e);
    if (e.key === 'Escape') cancelRename(e);
    e.stopPropagation();
  };

  const handleDeleteTopic = async (e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete topic "${topic.name}"? Documents will become unassigned.`)) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/topics/${topic.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        onTopicDeleted?.(topic.id);
      } else {
        console.error('Failed to delete topic');
      }
    } catch (err) {
      console.error('Failed to delete topic:', err);
    }
  };

  const handleRecluster = async (e) => {
    e.stopPropagation();
    if (!onReclusterUnassigned || isReclustering) return;
    setIsReclustering(true);
    try {
      await onReclusterUnassigned();
    } finally {
      setIsReclustering(false);
    }
  };

  const isUnassigned = topic.id === null || topic.id === undefined;

  return (
    <div className="mb-4">
      {/* Topic header — also the drop target */}
      <div
        ref={setDropRef}
        className={cn(
          'group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer select-none',
          'bg-gray-50 dark:bg-gray-800/60 border transition-colors',
          isOver
            ? 'border-purple-400 bg-purple-50 dark:bg-purple-900/20 ring-2 ring-purple-400 ring-inset'
            : 'border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
        )}
        onClick={() => !renaming && setExpanded(v => !v)}
      >
        <motion.div
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.18 }}
          className="shrink-0 text-gray-400"
        >
          <ChevronRight className="w-4 h-4" />
        </motion.div>

        <FolderOpen className={cn(
          'w-4 h-4 shrink-0',
          isUnassigned
            ? 'text-gray-400 dark:text-gray-500'
            : 'text-purple-500 dark:text-purple-400'
        )} />

        {/* Topic name / inline rename input */}
        {renaming ? (
          <input
            ref={inputRef}
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={saveRename}
            onClick={e => e.stopPropagation()}
            disabled={saving}
            className={cn(
              'flex-1 text-sm font-medium bg-white dark:bg-gray-900',
              'border border-purple-400 rounded px-2 py-0.5 outline-none',
              'text-gray-900 dark:text-gray-100'
            )}
          />
        ) : (
          <span className={cn(
            'flex-1 text-sm font-medium truncate',
            isUnassigned
              ? 'text-gray-500 dark:text-gray-400 italic'
              : 'text-gray-800 dark:text-gray-200'
          )}>
            {topic.name}
          </span>
        )}

        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500 font-mono">
          {documents.length}
        </span>

        {/* Action buttons */}
        <div
          className={cn(
            'flex items-center gap-1 shrink-0',
            renaming ? 'flex' : 'invisible group-hover:visible'
          )}
          onClick={e => e.stopPropagation()}
        >
          {isUnassigned ? (
            onReclusterUnassigned && (
              <button
                onClick={handleRecluster}
                disabled={isReclustering || documents.length === 0}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
                  'text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30',
                  (isReclustering || documents.length === 0) && 'opacity-50 cursor-not-allowed'
                )}
                title="Auto-organize these documents into topics"
              >
                {isReclustering
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Sparkles className="w-3.5 h-3.5" />
                }
                <span>{isReclustering ? 'Organizing…' : 'Auto-organize'}</span>
              </button>
            )
          ) : renaming ? (
            <>
              <button
                onClick={saveRename}
                disabled={saving}
                className="p-1 rounded text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30"
                title="Save"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={cancelRename}
                className="p-1 rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                title="Cancel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={startRename}
                className="p-1 rounded text-gray-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/30"
                title="Rename topic"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleDeleteTopic}
                className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                title="Delete topic"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Documents */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="documents"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            {documents.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic px-4 py-3">
                {isUnassigned ? 'No unassigned documents.' : 'No documents in this topic.'}
              </p>
            ) : (
              <div className="mt-2 pl-2 flex flex-col gap-2">
                {documents.map(doc => (
                  <DraggableDocumentRow
                    key={doc.id}
                    docId={doc.id}
                    docFilename={doc.filename}
                    currentTopicId={topic.id}
                  >
                    <DocumentCard
                      document={doc}
                      viewMode="list"
                      showLabels={showLabels}
                      onView={onView}
                      onDelete={onDelete}
                      onToggleStar={onToggleStar}
                      onToggleSelect={onToggleSelect}
                      onRename={onRename}
                    />
                  </DraggableDocumentRow>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
