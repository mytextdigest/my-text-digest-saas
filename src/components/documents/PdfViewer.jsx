'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  PanelLeft, ChevronLeft, ChevronRight, Minus, Plus, Hand, MoveHorizontal,
  Download, Printer, MoreVertical, RotateCw, RotateCcw, ExternalLink, ChevronDown, Maximize,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import PdfPage from './viewer/PdfPage';
import PdfThumbnails from './viewer/PdfThumbnails';
import { useNearPages } from './viewer/useNearPages';
import {
  ViewerToolbar, ToolbarButton, ToolbarDivider, ToolbarSpacer, ToolbarMenu,
  useDocumentFileActions, ViewerError,
} from './viewer/ViewerToolbar';
import { printImages } from '@/lib/printDocument';

// PDF points -> CSS px, so "100%" means actual size (same convention as pdf.js's viewer).
const PT_TO_PX = 96 / 72; // keep in sync with viewer/PdfPage.jsx
const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const PAGE_GAP = 16;
const SIDE_PADDING = 16;
const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

// docId: enables download / open in new tab (optional — the toolbar hides them without it).
// jumpTo: { page, box?: [page, x0, y0, x1, y1] in unscaled top-left PDF
// points, nonce } — scrolls to the page and briefly highlights the box
// (used by the Tables tab's "Show in document").
export default function PdfViewer({ fileUrl, docId, filename, onPageChange, onTotalPages, jumpTo }) {
  const scrollRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [baseSizes, setBaseSizes] = useState([]); // unscaled page sizes in CSS px, rotation 0
  const [loadError, setLoadError] = useState(null);

  const [fitWidth, setFitWidth] = useState(true);
  const [manualZoom, setManualZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [handTool, setHandTool] = useState(false);
  const [showThumbs, setShowThumbs] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [highlight, setHighlight] = useState(null);
  const [dragging, setDragging] = useState(false);
  const files = useDocumentFileActions(docId, fileUrl);

  const onPageChangeRef = useRef(onPageChange);
  const onTotalPagesRef = useRef(onTotalPages);
  useEffect(() => { onPageChangeRef.current = onPageChange; }, [onPageChange]);
  useEffect(() => { onTotalPagesRef.current = onTotalPages; }, [onTotalPages]);

  const numPages = baseSizes.length;
  const sideways = rotation % 180 !== 0;
  const sizes = sideways ? baseSizes.map(({ w, h }) => ({ w: h, h: w })) : baseSizes;
  const maxWidth = sizes.reduce((m, s) => Math.max(m, s.w), 0);
  const zoom = fitWidth && maxWidth && containerWidth
    ? clampZoom((containerWidth - SIDE_PADDING * 2) / maxWidth)
    : manualZoom;

  // ---- Load the document and measure every page (cheap; no drawing). ----
  useEffect(() => {
    if (!fileUrl) return;
    let cancelled = false;
    let loaded = null;
    setPdf(null);
    setBaseSizes([]);
    setLoadError(null);
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf/pdf.worker.min.js';
        loaded = await pdfjs.getDocument(fileUrl).promise;
        if (cancelled) return;
        const measured = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          const vp = (await loaded.getPage(i)).getViewport({ scale: PT_TO_PX });
          measured.push({ w: vp.width, h: vp.height });
        }
        if (cancelled) return;
        setPdf(loaded);
        setBaseSizes(measured);
        onTotalPagesRef.current?.(loaded.numPages);
      } catch (err) {
        if (!cancelled) setLoadError(err.message);
      }
    })();
    return () => {
      cancelled = true;
      loaded?.destroy();
    };
  }, [fileUrl]);

  // ---- Track the viewer's width (fit-to-width follows window/splitter resizes). ----
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [showThumbs]);

  const { near, register, elements } = useNearPages(scrollRef, '150% 0px', numPages > 0);

  // ---- Current page + scroll anchor (what stays put across zoom/rotate/resize). ----
  const anchorRef = useRef(null); // null until the reader first scrolls
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const probe = el.scrollTop + el.clientHeight * 0.3;
    let page = 1;
    for (let i = 1; i <= numPages; i++) {
      const p = elements.current.get(i);
      if (!p) continue;
      if (p.offsetTop <= probe) page = i;
      else break;
    }
    const p = elements.current.get(page);
    anchorRef.current = {
      page,
      frac: p ? (el.scrollTop - p.offsetTop) / Math.max(1, p.offsetHeight) : 0,
      xFrac: (el.scrollLeft + el.clientWidth / 2) / Math.max(1, el.scrollWidth),
    };
    setCurrentPage(page);
  }, [numPages, elements]);

  useEffect(() => {
    setPageInput(String(currentPage));
    onPageChangeRef.current?.(currentPage);
  }, [currentPage]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !anchorRef.current) return;
    const { page, frac, xFrac } = anchorRef.current;
    const p = elements.current.get(page);
    if (!p) return;
    el.scrollTop = p.offsetTop + frac * p.offsetHeight;
    el.scrollLeft = xFrac * el.scrollWidth - el.clientWidth / 2;
  }, [zoom, rotation, elements]);

  // ---- Navigation ----
  const goToPage = useCallback((n, block = 'start') => {
    const page = Math.min(Math.max(1, n), numPages);
    const el = elements.current.get(page);
    const root = scrollRef.current;
    if (!el || !root) return;
    if (block === 'center') el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else root.scrollTo({ top: el.offsetTop - PAGE_GAP, behavior: 'smooth' });
  }, [numPages, elements]);

  const commitPageInput = () => {
    const n = parseInt(pageInput, 10);
    if (Number.isFinite(n)) goToPage(n);
    else setPageInput(String(currentPage));
  };

  // ---- Zoom ----
  // zoomRef is updated eagerly so rapid clicks step from each other, not from a stale render.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const setZoom = (z) => {
    zoomRef.current = clampZoom(z);
    setFitWidth(false);
    setManualZoom(zoomRef.current);
  };
  const zoomIn = () => setZoom(ZOOM_PRESETS.find((p) => p > zoomRef.current * 1.01) ?? MAX_ZOOM);
  const zoomOut = () => setZoom([...ZOOM_PRESETS].reverse().find((p) => p < zoomRef.current * 0.99) ?? MIN_ZOOM);

  // Ctrl/Cmd + wheel zooms (needs a non-passive listener to stop the page zooming).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomRef.current = clampZoom(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
      setFitWidth(false);
      setManualZoom(zoomRef.current);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [numPages]);

  // ---- Hand tool: drag to pan ----
  const dragRef = useRef(null);
  const onPointerDown = (e) => {
    if (!handTool || e.button !== 0) return;
    const el = scrollRef.current;
    dragRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const el = scrollRef.current;
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  };
  const onPointerUp = () => { dragRef.current = null; setDragging(false); };

  // ---- Jump to a page (and highlight a region) on request ----
  useEffect(() => {
    if (!jumpTo?.page || numPages === 0) return;
    goToPage(jumpTo.page, jumpTo.box ? 'center' : 'start');
    if (jumpTo.box) {
      setHighlight({ page: jumpTo.page, box: jumpTo.box, nonce: jumpTo.nonce });
      const t = setTimeout(() => setHighlight(null), 4000);
      return () => clearTimeout(t);
    }
  }, [jumpTo, numPages, goToPage]);

  const highlightStyle = (pageNum) => {
    // Box coordinates are for the unrotated page.
    if (!highlight || highlight.page !== pageNum || rotation !== 0) return null;
    const s = zoom * PT_TO_PX;
    const [, x0, y0, x1, y1] = highlight.box;
    const pad = 4;
    return { left: (x0 - pad) * s, top: (y0 - pad) * s, width: (x1 - x0 + pad * 2) * s, height: (y1 - y0 + pad * 2) * s };
  };

  // ---- Print: draw every page to an image and print those. ----
  const handlePrint = async () => {
    if (!pdf || printing) return;
    setPrinting(true);
    try {
      const images = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2, rotation: (page.rotate + rotation) % 360 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        images.push(canvas.toDataURL('image/jpeg', 0.92));
        canvas.width = 0;
      }
      const res = await printImages(images, filename);
      if (res && !res.success) files.setError(res.error);
    } catch (err) {
      files.setError(err.message || 'Could not print.');
    } finally {
      setPrinting(false);
    }
  };

  const rotate = (delta) => setRotation((r) => (r + delta + 360) % 360);

  if (loadError) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p className="text-red-500 text-sm px-4 text-center">Failed to load PDF: {loadError}</p>
      </div>
    );
  }

  const zoomItems = [
    { label: 'Fit to width', icon: MoveHorizontal, onClick: () => setFitWidth(true), active: fitWidth },
    { label: 'Actual size', icon: Maximize, onClick: () => setZoom(1), active: !fitWidth && manualZoom === 1 },
    'divider',
    ...ZOOM_PRESETS.map((p) => ({ label: `${Math.round(p * 100)}%`, onClick: () => setZoom(p), active: !fitWidth && manualZoom === p })),
  ];

  // Entries with `collapse` stand in for toolbar buttons hidden for lack of room.
  const moreItems = [
    { label: showThumbs ? 'Hide page thumbnails' : 'Show page thumbnails', icon: PanelLeft, onClick: () => setShowThumbs((v) => !v), active: showThumbs, collapse: 'lg' },
    { label: handTool ? 'Turn off hand tool' : 'Hand tool (drag to pan)', icon: Hand, onClick: () => setHandTool((v) => !v), active: handTool, collapse: 'lg' },
    { label: 'Fit to width', icon: MoveHorizontal, onClick: () => setFitWidth(true), active: fitWidth, collapse: 'lg' },
    { divider: true, collapse: 'lg' },
    { label: 'Zoom in', icon: Plus, onClick: zoomIn, collapse: 'md' },
    { label: 'Zoom out', icon: Minus, onClick: zoomOut, collapse: 'md' },
    ...(docId ? [{ label: 'Download', icon: Download, onClick: files.download, collapse: 'md' }] : []),
    { label: 'Print', icon: Printer, onClick: handlePrint, disabled: !pdf || printing, collapse: 'md' },
    { divider: true, collapse: 'md' },
    { label: 'Rotate clockwise', icon: RotateCw, onClick: () => rotate(90) },
    { label: 'Rotate counter-clockwise', icon: RotateCcw, onClick: () => rotate(-90) },
    ...(docId ? ['divider', { label: 'Open in new tab', icon: ExternalLink, onClick: files.openExternally }] : []),
  ];

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden">
      <ViewerToolbar>
        <ToolbarButton icon={PanelLeft} label={showThumbs ? 'Hide page thumbnails' : 'Show page thumbnails'} onClick={() => setShowThumbs((v) => !v)} active={showThumbs} disabled={!numPages} collapse="lg" />
        <ToolbarDivider collapse="lg" />
        <ToolbarButton icon={ChevronLeft} label="Previous page" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} />
        <div className="shrink-0 flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
            onBlur={commitPageInput}
            onKeyDown={(e) => { if (e.key === 'Enter') { commitPageInput(); e.currentTarget.blur(); } }}
            aria-label="Page number"
            disabled={!numPages}
            className="w-9 h-7 text-center rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <span className="whitespace-nowrap">/ {numPages || '–'}</span>
        </div>
        <ToolbarButton icon={ChevronRight} label="Next page" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= numPages} />
        <ToolbarDivider />
        <ToolbarButton icon={Minus} label="Zoom out" onClick={zoomOut} disabled={!numPages || zoom <= MIN_ZOOM} collapse="md" />
        <ToolbarMenu
          align="left"
          items={zoomItems}
          trigger={({ open, toggle }) => (
            <ToolbarButton label="Zoom level" onClick={toggle} active={open} disabled={!numPages} className="gap-0.5 w-[4.25rem] text-sm tabular-nums">
              {Math.round(zoom * 100)}%<ChevronDown className="h-3 w-3 opacity-60" />
            </ToolbarButton>
          )}
        />
        <ToolbarButton icon={Plus} label="Zoom in" onClick={zoomIn} disabled={!numPages || zoom >= MAX_ZOOM} collapse="md" />
        <ToolbarDivider collapse="lg" />
        <ToolbarButton icon={Hand} label={handTool ? 'Hand tool (drag to pan) — on' : 'Hand tool (drag to pan)'} onClick={() => setHandTool((v) => !v)} active={handTool} collapse="lg" />
        <ToolbarButton icon={MoveHorizontal} label="Fit to width" onClick={() => setFitWidth(true)} active={fitWidth} disabled={!numPages} collapse="lg" />
        <ToolbarSpacer />
        {docId && <ToolbarButton icon={Download} label="Download" onClick={files.download} collapse="md" />}
        <ToolbarButton icon={Printer} label={printing ? 'Preparing to print…' : 'Print'} onClick={handlePrint} busy={printing} disabled={!pdf} collapse="md" />
        <ToolbarMenu icon={MoreVertical} label="More" items={moreItems} />
      </ViewerToolbar>

      <div className="flex flex-1 min-h-0">
        {showThumbs && numPages > 0 && (
          <PdfThumbnails pdf={pdf} sizes={sizes} rotation={rotation} currentPage={currentPage} onSelect={(n) => goToPage(n)} />
        )}

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ scrollbarGutter: 'stable' }}
          className={cn(
            'relative flex-1 min-w-0 overflow-auto bg-gray-100 dark:bg-gray-800 custom-scrollbar',
            handTool && (dragging ? 'cursor-grabbing select-none' : 'cursor-grab select-none')
          )}
        >
          {numPages === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">Loading PDF...</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center w-max min-w-full" style={{ gap: PAGE_GAP, padding: `${PAGE_GAP}px ${SIDE_PADDING}px` }}>
              {sizes.map((size, i) => {
                const pageNum = i + 1;
                const hl = highlightStyle(pageNum);
                return (
                  <PdfPage
                    key={pageNum}
                    ref={register(pageNum)}
                    pdf={pdf}
                    pageNum={pageNum}
                    scale={zoom}
                    rotation={rotation}
                    size={size}
                    active={near.has(pageNum)}
                    className="shadow-md"
                  >
                    {hl && (
                      <div
                        key={highlight.nonce}
                        className="absolute pointer-events-none rounded border-2 border-primary-500 bg-primary-400/15 animate-pulse"
                        style={hl}
                      />
                    )}
                  </PdfPage>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ViewerError message={files.error} />
    </div>
  );
}
