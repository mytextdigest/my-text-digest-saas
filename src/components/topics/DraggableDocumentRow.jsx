'use client'
import { useDraggable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function DraggableDocumentRow({ docId, docFilename, currentTopicId, children }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `doc-${docId}`,
    data: { docId, docFilename, currentTopicId },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn('flex items-center gap-1', isDragging && 'opacity-40')}
    >
      <button
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing p-1 text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 shrink-0 touch-none rounded"
        tabIndex={-1}
        title="Drag to reassign topic"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
