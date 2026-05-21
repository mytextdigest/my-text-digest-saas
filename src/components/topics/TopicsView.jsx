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

export default function TopicsView({
  topics = [],
  documents = [],
  loading = false,
  projectId,
  onUpload,
  onView,
  onDelete,
  onToggleStar,
  onToggleSelect,
  onRename,
  onTopicsChange,
  onReclusterUnassigned,
  activeFilter = 'all',
  onFilterChange,
  className,
}) {
  const [viewMode, setViewMode]       = useState('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDocData, setActiveDocData] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const matchesSearch = (doc) =>
    !searchQuery ||
    (doc.filename || '').toLowerCase().includes(searchQuery.toLowerCase());

  const applyFilter = (doc) => {
    if (activeFilter === 'starred')    return !!doc.starred;
    if (activeFilter === 'unselected') return !doc.selected;
    return true;
  };

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

  const docCallbacks = { onView, onDelete, onToggleStar, onToggleSelect, onRename };

  const handleDragStart = ({ active }) => {
    setActiveDocData(active?.data?.current ?? null);
  };

  const handleDragEnd = async ({ active, over }) => {
    setActiveDocData(null);
    if (!over || !active?.data?.current) return;

    const { docId, currentTopicId } = active.data.current;
    const targetId = over.id;

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
      <div className={cn('flex flex-col space-y-4', className)}>
        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search documents..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>

          <div className="flex items-center gap-1 border border-gray-200 dark:border-gray-700 rounded-lg p-1">
            <button
              onClick={() => setViewMode('grid')}
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

          <Button
            variant="outline"
            size="sm"
            onClick={onUpload}
            className="h-9 text-sm"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload
          </Button>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
          {[
            { key: 'all',        label: 'All Documents' },
            { key: 'starred',    label: 'Starred' },
            { key: 'unselected', label: 'Unselected' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => onFilterChange?.(f.key)}
              className={cn(
                'text-xs px-3 py-1.5 rounded-full font-medium transition-colors',
                activeFilter === f.key
                  ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              )}
            >
              {f.label}
            </button>
          ))}
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
          <div className="space-y-2 overflow-y-auto flex-1">
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

            {/* Unassigned — always rendered as drop target */}
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
