'use client';
import { useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { Copy, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import SlideRenderer from './renderer/SlideRenderer';

const THUMB_SCALE = 12; // px-per-inch -> ~160px-wide thumbnails (13.3in slide width)

// One draggable + droppable thumbnail. Both hooks share the same `id` so a
// drop lands exactly on the thumbnail it was released over; PointerSensor's
// activation distance (see `sensors` below) is what lets a plain click still
// select a slide without a separate drag handle.
//
// Ported verbatim — @dnd-kit/core was already a dependency in this repo.
function SlideThumbnail({ index, slide, theme, isSelected, onSelect, onDuplicate, onDelete, canDelete, disabled }) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `thumb-${index}`,
    data: { index },
    disabled,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `thumb-${index}`,
    data: { index },
    disabled,
  });

  return (
    // A plain <div role="button"> rather than a real <button> — the
    // duplicate icon below needs to be its own clickable button, and
    // buttons can't nest. onPointerDown/stopPropagation on that icon (not
    // just onClick) is what keeps a click on it from also registering as
    // the start of a drag via dnd-kit's PointerSensor listeners spread here.
    <div
      ref={(node) => { setDragRef(node); setDropRef(node); }}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      title={slide.title || slide.type}
      className={cn(
        'group relative block rounded-lg overflow-hidden border-2 transition-colors touch-none',
        isSelected
          ? 'border-primary-500 ring-2 ring-primary-500/40'
          : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600',
        isOver && !isDragging && 'border-primary-400 ring-2 ring-primary-400/50',
        isDragging && 'opacity-30',
        disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
      )}
    >
      <span className="absolute top-1 left-1 z-10 min-w-[18px] h-[18px] px-1 rounded-full bg-black/60 text-white text-[10px] font-medium flex items-center justify-center leading-none">
        {index + 1}
      </span>
      {!disabled && (
        <div className="absolute top-1 right-1 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDuplicate?.(index); }}
            title="Duplicate slide"
            className="w-4.5 h-4.5 flex items-center justify-center rounded bg-black/60 text-white hover:bg-black/80"
          >
            <Copy className="w-3 h-3" />
          </button>
          {canDelete && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onDelete?.(index); }}
              title="Delete slide"
              className="w-4.5 h-4.5 flex items-center justify-center rounded bg-black/60 text-white hover:bg-red-600"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
      <SlideRenderer slide={slide} theme={theme} scale={THUMB_SCALE} slideIndex={index} />
    </div>
  );
}

// Slide filmstrip — vertical rail (classic) or horizontal bottom bar
// (Canva-style). Owns its own drag-to-reorder DndContext; the caller only
// supplies `onReorder(fromIndex, toIndex)` for persistence.
export default function SlideThumbnailRail({
  slides, theme, selectedIndex, onSelect, disabled, reorderError, onReorder, onDuplicate, onDelete,
  orientation = 'vertical',
}) {
  const [activeDragIndex, setActiveDragIndex] = useState(null);
  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const isHorizontal = orientation === 'horizontal';

  const handleDragStart = ({ active }) => {
    setActiveDragIndex(active?.data?.current?.index ?? null);
  };

  const handleDragCancel = () => setActiveDragIndex(null);

  const handleDragEnd = ({ active, over }) => {
    setActiveDragIndex(null);
    const fromIndex = active?.data?.current?.index;
    const toIndex = over?.data?.current?.index;
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return;
    onReorder(fromIndex, toIndex);
  };

  return (
    <DndContext
      sensors={dragSensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        className={cn(
          'shrink-0 border-gray-200 dark:border-gray-700 custom-scrollbar',
          isHorizontal
            ? 'h-32 w-full border-t overflow-x-auto flex items-center gap-3 px-3'
            : 'w-44 border-r overflow-y-auto p-3 space-y-3'
        )}
      >
        {reorderError && (
          <div
            className={cn(
              'text-xs px-2 py-1.5 rounded-md bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
              isHorizontal && 'shrink-0'
            )}
          >
            {reorderError}
          </div>
        )}
        {slides.map((slide, i) => (
          <div key={i} className={isHorizontal ? 'w-40 shrink-0' : undefined}>
            <SlideThumbnail
              index={i}
              slide={slide}
              theme={theme}
              isSelected={i === selectedIndex}
              onSelect={() => onSelect(i)}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              canDelete={slides.length > 1}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDragIndex != null && slides[activeDragIndex] && (
          <div className="w-40 rounded-lg overflow-hidden border-2 border-primary-500 shadow-2xl opacity-95 pointer-events-none">
            <SlideRenderer
              slide={slides[activeDragIndex]}
              theme={theme}
              scale={THUMB_SCALE}
              slideIndex={activeDragIndex}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
