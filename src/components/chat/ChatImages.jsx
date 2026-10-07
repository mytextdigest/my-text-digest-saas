'use client'
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Download, FolderPlus, Check, Maximize2, ImageIcon, AlertCircle, Sparkles, ChevronDown, Paperclip, ImagePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import ImageViewerModal, { ToolbarButton } from '@/components/ui/ImageViewerModal';
import { MAX_ATTACHMENTS, ATTACHABLE_TYPES } from './useChatImages';

// Quality tiers of a generated image. Images start as a quick draft; the
// estimates are for a 1536x1024 redraw (measured, gpt-image-2).
const QUALITY_LABELS = { low: 'Quick draft', medium: 'Standard', high: 'High detail' };
const QUALITY_RANK = { low: 0, medium: 1, high: 2 };
const IMPROVE_OPTIONS = [
  { value: 'medium', label: 'Standard', description: 'Cleaner lines and labels. Good for most slides.', estimate: '~30 s · ~5¢' },
  { value: 'high', label: 'High detail', description: 'Sharpest text and fine detail, for dense charts or a final export.', estimate: '~70 s · ~18¢' },
];

// Images the user attached to a message — compact thumbnails above the bubble.
export function MessageImageThumbs({ images, onOpen, align = 'right' }) {
  if (!images?.length) return null;
  return (
    <div className={cn('flex flex-wrap gap-2 mb-2', align === 'right' ? 'justify-end' : 'justify-start')}>
      {images.map((img, i) => (
        <button
          key={img.id ?? img.fileUrl}
          type="button"
          onClick={() => onOpen(i)}
          className="group relative h-28 max-w-[220px] overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white shadow-sm hover:shadow-md transition-shadow"
          title={img.name || 'Open image'}
        >
          <img src={img.fileUrl} alt={img.name || 'Attached image'} className="h-full w-auto object-contain" draggable={false} />
          <span className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
        </button>
      ))}
    </div>
  );
}

// An image the assistant generated — shown large, with quick actions.
// improving: { quality } while a higher-quality redraw is running.
export function GeneratedImage({ image, onOpen, onDownload, onSave, saveState, onImprove, onCancelImprove, improving, improveError }) {
  const saved = !!image.savedDocumentId || saveState === 'saved';
  const improveOptions = image.quality && onImprove
    ? IMPROVE_OPTIONS.filter((o) => QUALITY_RANK[o.value] > QUALITY_RANK[image.quality])
    : [];
  return (
    <div className="mt-3 w-full max-w-[560px]">
      <button
        type="button"
        onClick={onOpen}
        className="group relative block w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white shadow-sm hover:shadow-md transition-shadow cursor-zoom-in"
        style={image.width && image.height ? { aspectRatio: `${image.width} / ${image.height}` } : undefined}
        title="Open image"
      >
        <img src={image.fileUrl} alt="Generated image" className="h-full w-full object-contain" draggable={false} />
        <span className="absolute top-2 right-2 rounded-md bg-black/50 p-1.5 text-white opacity-0 group-hover:opacity-100 transition-opacity">
          <Maximize2 className="h-3.5 w-3.5" />
        </span>
      </button>
      <div className="mt-1.5 flex items-center gap-1">
        <ImageActionButton onClick={onDownload} title="Download image">
          <Download className="h-3.5 w-3.5" />
          Download
        </ImageActionButton>
        {onSave && (
          <ImageActionButton
            onClick={onSave}
            disabled={saved || saveState === 'saving'}
            title={saved ? 'Saved to this project' : 'Add this image to the project as a document'}
          >
            {saveState === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : saved ? <Check className="h-3.5 w-3.5 text-green-500" />
              : <FolderPlus className="h-3.5 w-3.5" />}
            {saved ? 'Saved to project' : 'Save to project'}
          </ImageActionButton>
        )}
        {improving ? (
          <span className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Redrawing in {QUALITY_LABELS[improving.quality]}…
            <button type="button" onClick={onCancelImprove} className="ml-1 text-gray-500 underline hover:text-gray-800 dark:hover:text-gray-100">
              Cancel
            </button>
          </span>
        ) : improveOptions.length > 0 && (
          <ImproveQualityMenu options={improveOptions} onSelect={onImprove} />
        )}
        {image.quality && (
          <span
            className="ml-auto rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400"
            title={image.quality === 'low' ? 'Generated quickly. Use Improve quality for a sharper version.' : undefined}
          >
            {QUALITY_LABELS[image.quality]}
          </span>
        )}
      </div>
      {improveError && (
        <p className="mt-1 flex items-start gap-1.5 px-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5 mt-px shrink-0" />
          {improveError}
        </p>
      )}
    </div>
  );
}

function ImproveQualityMenu({ options, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <ImageActionButton onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Redraw this image at a higher quality">
        <Sparkles className="h-3.5 w-3.5" />
        Improve quality
        <ChevronDown className={cn('h-3 w-3 transition-transform', !open && 'rotate-180')} />
      </ImageActionButton>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 bottom-full z-20 mb-1 w-72 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-1 shadow-lg"
            role="menu"
          >
            <p className="px-2.5 pt-1.5 pb-1 text-[11px] text-gray-500 dark:text-gray-400">
              Redraws this image as a new message, so you can compare the two.
            </p>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onSelect(o.value); }}
                className="w-full rounded-md px-2.5 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{o.label}</span>
                  <span className="text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{o.estimate}</span>
                </span>
                <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">{o.description}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ImageActionButton({ children, className, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300',
        'hover:bg-gray-100 dark:hover:bg-gray-800 disabled:cursor-default disabled:hover:bg-transparent transition-colors',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// Placeholder while an image is being generated (the image model takes a while).
export function ImageGeneratingPlaceholder({ status }) {
  return (
    <div className="mt-3 w-full max-w-[560px] aspect-[3/2] relative overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
      <motion.div
        className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/60 dark:via-white/10 to-transparent"
        animate={{ x: ['0%', '300%'] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
        <ImageIcon className="h-7 w-7" />
        <span className="text-xs font-medium">{status || 'Creating image… this can take up to a minute'}</span>
      </div>
    </div>
  );
}

// Staged attachments in the composer.
// items: [{ key, previewUrl, name, status: 'uploading' | 'ready' | 'error', error? }]
export function ComposerAttachments({ items, onRemove }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2">
      {items.map((item) => (
        <div
          key={item.key}
          className={cn(
            'relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-white',
            item.status === 'error' ? 'border-red-400' : 'border-gray-200 dark:border-gray-600'
          )}
          title={item.status === 'error' ? item.error : item.name}
        >
          <img src={item.previewUrl} alt={item.name} className="h-full w-full object-cover" draggable={false} />
          {item.status === 'uploading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-black/50">
              <Loader2 className="h-4 w-4 animate-spin text-gray-600 dark:text-gray-200" />
            </div>
          )}
          {item.status === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center bg-red-500/30">
              <AlertCircle className="h-4 w-4 text-white" />
            </div>
          )}
          <button
            type="button"
            onClick={() => onRemove(item.key)}
            className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
            title="Remove"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

// Paperclip button + its hidden file input. `composer` is useComposerAttachments().
export function AttachButton({ composer, disabled, className }) {
  return (
    <>
      <input
        ref={composer.fileInputRef}
        type="file"
        accept={ATTACHABLE_TYPES.join(',')}
        multiple
        className="hidden"
        onChange={(e) => { composer.addFiles(e.target.files); e.target.value = ''; }}
      />
      <button
        type="button"
        onClick={composer.openFilePicker}
        disabled={disabled || composer.isFull}
        className={cn(
          'p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
          className
        )}
        title={composer.isFull ? `Up to ${MAX_ATTACHMENTS} images` : 'Attach images'}
      >
        <Paperclip className="h-4 w-4" />
      </button>
    </>
  );
}

// Shown over the chat while image files are dragged onto it. The parent
// needs `relative` positioning and composer.dropHandlers.
export function DropOverlay({ visible }) {
  if (!visible) return null;
  return (
    <div className="absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-400 bg-blue-50/90 dark:bg-blue-950/80 text-blue-600 dark:text-blue-300 pointer-events-none">
      <ImagePlus className="h-8 w-8" />
      <span className="text-sm font-medium">Drop images to attach (PNG, JPG, WEBP — up to {MAX_ATTACHMENTS})</span>
    </div>
  );
}

// The full-screen viewer for chat images. `actions` is useChatImageActions().
export function ChatImageViewer({ actions }) {
  const { viewer, closeViewer, saveStates, saveImageToProject } = actions;
  return (
    <ImageViewerModal
      open={!!viewer}
      images={(viewer?.images || []).map(img => ({
        src: img.fileUrl,
        title: img.direction === 'output' ? 'Generated image' : (img.name || 'Attached image'),
        downloadName: img.direction === 'output' ? 'generated-image.png' : (img.name || 'image.png'),
      }))}
      initialIndex={viewer?.index || 0}
      onClose={closeViewer}
      renderActions={(_, i) => {
        const img = viewer?.images?.[i];
        if (!img || !actions.generatedImageProps(img).onSave) return null;
        const saved = !!img.savedDocumentId || saveStates[img.id] === 'saved';
        return (
          <ToolbarButton
            title={saved ? 'Saved to this project' : 'Save to project'}
            onClick={() => saveImageToProject(img)}
            disabled={saved || saveStates[img.id] === 'saving'}
          >
            {saveStates[img.id] === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" />
              : saved ? <Check className="h-4 w-4 text-green-400" />
              : <FolderPlus className="h-4 w-4" />}
          </ToolbarButton>
        );
      }}
    />
  );
}
