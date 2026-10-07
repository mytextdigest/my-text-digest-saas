'use client'
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, ZoomIn, ZoomOut, Maximize, Download, Copy, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import chatImagesApi from '@/lib/chatImagesApi';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const canCopyImages = () => typeof navigator !== 'undefined' && !!navigator.clipboard?.write && typeof ClipboardItem !== 'undefined';

// Full-screen image viewer: wheel / button / keyboard zoom, drag to pan,
// fit vs. actual size, download, copy, and arrow-key paging through several
// images. Generic — callers pass plain image descriptors and can add their
// own toolbar buttons through `renderActions`.
//
// images: [{ src, alt?, title?, downloadName? }]
// renderActions(image, index) -> ReactNode  — extra toolbar buttons
export default function ImageViewerModal({ open, images = [], initialIndex = 0, onClose, renderActions }) {
  const [index, setIndex] = useState(initialIndex);
  // zoom 1 = fit to screen; x/y = pan offset in px. One object so a zoom
  // and the pan that keeps the cursor anchored update together.
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [fitScale, setFitScale] = useState(1);   // displayed px / natural px at zoom 1
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState(null);
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);

  const image = images[index];

  useEffect(() => {
    if (open) setIndex(Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)));
  }, [open, initialIndex, images.length]);

  const resetView = useCallback(() => setView({ zoom: 1, x: 0, y: 0 }), []);

  useEffect(() => { resetView(); setCopied(false); }, [index, open, resetView]);

  const measureFit = useCallback(() => {
    const img = imgRef.current;
    if (img?.naturalWidth) setFitScale(img.offsetWidth / img.naturalWidth);
  }, []);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', measureFit);
    return () => window.removeEventListener('resize', measureFit);
  }, [open, measureFit]);

  // Zoom keeping the point under `anchor` (relative to the stage centre) fixed.
  const zoomTo = useCallback((nextZoom, anchor = { x: 0, y: 0 }) => {
    setView((v) => {
      const nz = clampZoom(nextZoom(v.zoom));
      if (nz === 1) return { zoom: 1, x: 0, y: 0 };
      return {
        zoom: nz,
        x: anchor.x - ((anchor.x - v.x) * nz) / v.zoom,
        y: anchor.y - ((anchor.y - v.y) * nz) / v.zoom,
      };
    });
  }, []);

  const anchorFromEvent = (e) => {
    const rect = stageRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 };
  };

  // React's onWheel is passive, so preventDefault needs a native listener.
  useEffect(() => {
    const stage = stageRef.current;
    if (!open || !stage) return;
    const onWheel = (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomTo((z) => z * factor, anchorFromEvent(e));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [open, zoomTo, index]);

  const go = useCallback((delta) => {
    if (images.length < 2) return;
    setIndex((i) => (i + delta + images.length) % images.length);
  }, [images.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === '+' || e.key === '=') zoomTo((z) => z * 1.25);
      else if (e.key === '-') zoomTo((z) => z / 1.25);
      else if (e.key === '0') resetView();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, go, zoomTo, resetView]);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX, startY: e.clientY, origin: { x: view.x, y: view.y },
      moved: false, onBackdrop: e.target === stageRef.current,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) {
      drag.moved = true;
      setDragging(true);
    }
    if (drag.moved) setView((v) => ({ ...v, x: drag.origin.x + dx, y: drag.origin.y + dy }));
  };
  const onPointerUp = (e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    // A plain click on the backdrop (not the image) closes the viewer.
    if (drag && !drag.moved && drag.onBackdrop) onClose?.();
  };
  const onDoubleClick = (e) => {
    const anchor = anchorFromEvent(e);
    zoomTo((z) => (z > 1.01 ? 1 : 2.5), anchor);
  };

  const flash = (text) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 2200);
  };

  const handleDownload = async () => {
    if (!image) return;
    const name = image.downloadName || 'image.png';
    const res = await chatImagesApi.saveImageAs({ fileUrl: image.src, defaultName: name });
    if (res?.success) flash('Image saved');
    else if (!res?.canceled) flash(res?.error || 'Could not save the image');
  };

  const handleCopy = async () => {
    if (!image || !canCopyImages()) return;
    const res = await chatImagesApi.copyImageToClipboard({ fileUrl: image.src });
    if (res?.success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      flash(res?.error || 'Could not copy the image');
    }
  };

  if (typeof document === 'undefined') return null;
  const { zoom } = view;
  const actualPercent = Math.round(zoom * fitScale * 100);

  return createPortal(
    <AnimatePresence>
      {open && image && (
        <motion.div
          key="image-viewer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex flex-col bg-black/90 text-white select-none"
          role="dialog"
          aria-modal="true"
          aria-label={image.title || 'Image viewer'}
        >
          {/* Top bar */}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-black/40 border-b border-white/10 shrink-0">
            <div className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">
              {image.title || image.alt || 'Image'}
              {images.length > 1 && (
                <span className="ml-2 text-white/50 font-normal">{index + 1} / {images.length}</span>
              )}
            </div>

            <div className="flex items-center gap-0.5 rounded-lg bg-white/10 px-1 py-0.5">
              <ToolbarButton title="Zoom out (−)" onClick={() => zoomTo((z) => z / 1.25)} disabled={zoom <= MIN_ZOOM}>
                <ZoomOut className="h-4 w-4" />
              </ToolbarButton>
              <button
                onClick={() => zoomTo(() => 1 / (fitScale || 1))}
                title="Actual size"
                className="w-14 text-center text-xs tabular-nums text-white/80 hover:text-white"
              >
                {actualPercent}%
              </button>
              <ToolbarButton title="Zoom in (+)" onClick={() => zoomTo((z) => z * 1.25)} disabled={zoom >= MAX_ZOOM}>
                <ZoomIn className="h-4 w-4" />
              </ToolbarButton>
              <ToolbarButton title="Fit to screen (0)" onClick={resetView} disabled={zoom === 1 && view.x === 0 && view.y === 0}>
                <Maximize className="h-4 w-4" />
              </ToolbarButton>
            </div>

            <div className="flex items-center gap-0.5">
              {renderActions?.(image, index)}
              {canCopyImages() && (
                <ToolbarButton title="Copy image" onClick={handleCopy}>
                  {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                </ToolbarButton>
              )}
              <ToolbarButton title="Download" onClick={handleDownload}>
                <Download className="h-4 w-4" />
              </ToolbarButton>
              <div className="w-px h-5 bg-white/15 mx-1" />
              <ToolbarButton title="Close (Esc)" onClick={onClose}>
                <X className="h-5 w-5" />
              </ToolbarButton>
            </div>
          </div>

          {/* Stage */}
          <div
            ref={stageRef}
            className={cn('relative flex-1 min-h-0 overflow-hidden flex items-center justify-center touch-none', zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={onDoubleClick}
          >
            <img
              ref={imgRef}
              src={image.src}
              alt={image.alt || image.title || 'Image'}
              draggable={false}
              onLoad={measureFit}
              className="max-w-[calc(100%-4rem)] max-h-[calc(100%-4rem)] object-contain shadow-2xl bg-white"
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${zoom})`,
                transition: dragging ? 'none' : 'transform 0.08s ease-out',
              }}
            />

            {images.length > 1 && (
              <>
                <NavButton side="left" onClick={() => go(-1)}><ChevronLeft className="h-6 w-6" /></NavButton>
                <NavButton side="right" onClick={() => go(1)}><ChevronRight className="h-6 w-6" /></NavButton>
              </>
            )}

            {notice && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/15 backdrop-blur px-4 py-1.5 text-xs">
                {notice}
              </div>
            )}
          </div>

          {/* Thumbnail strip */}
          {images.length > 1 && (
            <div className="flex justify-center gap-2 px-4 py-2.5 bg-black/40 border-t border-white/10 shrink-0 overflow-x-auto">
              {images.map((img, i) => (
                <button
                  key={`${img.src}-${i}`}
                  onClick={() => setIndex(i)}
                  className={cn(
                    'h-12 w-16 shrink-0 rounded overflow-hidden border-2 bg-white transition-opacity',
                    i === index ? 'border-blue-400 opacity-100' : 'border-transparent opacity-50 hover:opacity-90'
                  )}
                  title={img.title || `Image ${i + 1}`}
                >
                  <img src={img.src} alt="" className="h-full w-full object-cover" draggable={false} />
                </button>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export function ToolbarButton({ children, className, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        'p-1.5 rounded-md text-white/80 hover:text-white hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function NavButton({ side, children, onClick }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white/80 hover:text-white transition-colors',
        side === 'left' ? 'left-4' : 'right-4'
      )}
    >
      {children}
    </button>
  );
}
