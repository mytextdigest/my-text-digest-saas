'use client'
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Grid, List, Search, Upload, GripVertical } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import TopicGroup from './TopicGroup';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

const FILTERS = [
  { key: 'all',        label: 'All Documents' },
  { key: 'starred',    label: 'Starred' },
  { key: 'unselected', label: 'Unselected' },
];

// Upload lives in the page header; onUpload is still used by the empty state.
export default function TopicsView({
  topics = [],
  documents = [],
  projectId,
  loading = false,
  onUpload,
  onView,
  onDelete,
  onToggleStar,
  onToggleSelect,
  onRename,
  onRetry,
  onTopicsChange,
  onReclusterUnassigned,
  activeFilter = 'all',
  onFilterChange,
  className,
}) {
  const [viewMode, setViewMode]       = useState('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDocData, setActiveDocData] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Filter documents for search
  const matchesSearch = (doc) =>
    !searchQuery ||
    (doc.filename || '').toLowerCase().includes(searchQuery.toLowerCase());

  // Apply top-level filter (starred / unselected)
  const applyFilter = (doc) => {
    if (activeFilter === 'starred')    return !!doc.starred;
    if (activeFilter === 'unselected') return !doc.selected;
    return true;
  };

  // Build a map of topicId → [docs]
  const topicDocMap = {};
  const unassigned  = [];

  for (const doc of documents) {
    if (!matchesSearch(doc) || !applyFilter(doc)) continue;
    if (doc.topicId) {
      (topicDocMap[doc.topicId] = topicDocMap[doc.topicId] || []).push(doc);
    } else {
      unassigned.push(doc);
    }
  }

  const docCallbacks = { onView, onDelete, onToggleStar, onToggleSelect, onRename, onRetry };

  const handleDragStart = ({ active }) => {
    setActiveDocData(active?.data?.current ?? null);
  };

  const handleDragEnd = async ({ active, over }) => {
    setActiveDocData(null);
    if (!over || !active?.data?.current) return;

    const { docId, currentTopicId } = active.data.current;
    const targetId = over.id;

    // No-op: same topic or same unassigned state
    const sourceIsUnassigned = currentTopicId === null || currentTopicId === undefined;
    if (targetId === 'unassigned' && sourceIsUnassigned) return;
    if (targetId === currentTopicId) return;

    try {
      if (targetId === 'unassigned') {
        await fetch(`/api/documents/${docId}/unassign`, { method: 'POST' });
      } else {
        await fetch(`/api/documents/${docId}/move-to-topic`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topicId: targetId }),
        });
      }
      await onTopicsChange?.();
    } catch (err) {
      console.error('Failed to move document:', err);
    }
  };

  const handleDragCancel = () => setActiveDocData(null);

  if (loading) {
    return (
      <div className={cn('space-y-3', className)}>
        {[1, 2, 3].map(i => (
          <div key={i} className="h-14 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  const isEmpty = documents.length === 0;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={cn('h-full flex flex-col min-h-0', className)}>
        {/* Controls: one row. The filter pills become a dropdown when the
            column is too narrow for them (container query on this row). */}
        <div className="@container shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="relative flex-1 min-w-28">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search documents..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>

            <div className="hidden @xl:flex items-center gap-1 shrink-0">
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  onClick={() => onFilterChange?.(f.key)}
                  aria-pressed={activeFilter === f.key}
                  className={cn(
                    'h-8 text-xs px-3 rounded-full font-medium whitespace-nowrap transition-colors',
                    activeFilter === f.key
                      ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <select
              value={activeFilter}
              onChange={e => onFilterChange?.(e.target.value)}
              aria-label="Filter documents"
              className="@xl:hidden shrink-0 h-8 pl-2 pr-7 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>

            <div className="shrink-0 flex items-center gap-0.5 border border-gray-200 dark:border-gray-700 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                aria-pressed={viewMode === 'grid'}
                className={cn(
                  'p-1.5 rounded transition-colors',
                  viewMode === 'grid'
                    ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400'
                    : 'text-gray-400 hover:text-gray-600'
                )}
                title="Expanded view"
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                aria-pressed={viewMode === 'list'}
                className={cn(
                  'p-1.5 rounded transition-colors',
                  viewMode === 'list'
                    ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400'
                    : 'text-gray-400 hover:text-gray-600'
                )}
                title="Compact view"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {isEmpty ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
              <Upload className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              No documents yet
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-xs">
              Upload documents and the workspace will organise them into topics automatically.
            </p>
            <Button variant="outline" onClick={onUpload}>
              <Upload className="w-4 h-4 mr-2" />
              Upload Documents
            </Button>
          </motion.div>
        ) : (
          <div className="space-y-2 overflow-y-auto flex-1 min-h-0 p-3 bg-gray-50 dark:bg-gray-900 custom-scrollbar">
            {/* Named topics */}
            {topics.map(topic => (
              <TopicGroup
                key={topic.id}
                topic={topic}
                documents={topicDocMap[topic.id] || []}
                projectId={projectId}
                showLabels={viewMode === 'grid'}
                onTopicRenamed={() => onTopicsChange?.()}
                onTopicDeleted={() => onTopicsChange?.()}
                {...docCallbacks}
              />
            ))}

            {/* Unassigned documents — always rendered so it acts as a drop target */}
            {(unassigned.length > 0 || topics.length > 0) && (
              <TopicGroup
                key="unassigned"
                topic={{ id: null, name: 'Unassigned', document_count: unassigned.length }}
                documents={unassigned}
                projectId={projectId}
                showLabels={viewMode === 'grid'}
                defaultExpanded={topics.length === 0}
                onReclusterUnassigned={onReclusterUnassigned}
                {...docCallbacks}
              />
            )}
          </div>
        )}
      </div>

      {/* Floating drag preview */}
      <DragOverlay dropAnimation={null}>
        {activeDocData && (
          <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border border-purple-300 dark:border-purple-600 rounded-lg shadow-xl text-sm font-medium text-gray-700 dark:text-gray-200 pointer-events-none max-w-xs">
            <GripVertical className="w-4 h-4 text-purple-400 shrink-0" />
            <span className="truncate">{activeDocData.docFilename || 'Document'}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
