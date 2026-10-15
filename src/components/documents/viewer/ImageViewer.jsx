"use client";
import { useEffect, useRef, useState } from "react";
import FileViewerFrame from "./FileViewerFrame";
import { printImages } from "@/lib/printDocument";

const STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const PADDING = 24;

// Image document viewer. Starts fitted to the panel; zooming sets a real width
// (not a CSS transform) so the scroll area grows and every edge is reachable.
export default function ImageViewer({ docId, fileUrl, filename }) {
  const scrollRef = useRef(null);
  const [natural, setNatural] = useState(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [manual, setManual] = useState(null); // null = fit to view

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = natural && box.w
    ? Math.min(1, (box.w - PADDING * 2) / natural.w, (box.h - PADDING * 2) / natural.h)
    : 1;
  const zoom = manual ?? fit;

  const zoomControls = {
    value: zoom,
    isFit: manual == null,
    canIn: zoom < STEPS[STEPS.length - 1],
    canOut: zoom > STEPS[0],
    onIn: () => setManual(STEPS.find((s) => s > zoom * 1.01) ?? STEPS[STEPS.length - 1]),
    onOut: () => setManual([...STEPS].reverse().find((s) => s < zoom * 0.99) ?? STEPS[0]),
    onFit: () => setManual(null),
  };

  return (
    <FileViewerFrame
      ref={scrollRef}
      docId={docId}
      fileUrl={fileUrl}
      zoom={natural ? zoomControls : null}
      onPrint={() => printImages([fileUrl], filename)}
      contentClassName="bg-gray-100 dark:bg-gray-800"
    >
      <div className="min-w-full min-h-full w-max flex items-center justify-center" style={{ padding: PADDING }}>
        <img
          src={fileUrl}
          alt={filename}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={natural ? { width: natural.w * zoom, height: natural.h * zoom } : undefined}
          className="max-w-none rounded shadow-sm bg-white"
          draggable={false}
        />
      </div>
    </FileViewerFrame>
  );
}
