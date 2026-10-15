"use client";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import PdfPage from "./PdfPage";
import { useNearPages } from "./useNearPages";

const THUMB_WIDTH = 104;

// Sidebar of page previews. Previews are drawn lazily as they scroll into view.
export default function PdfThumbnails({ pdf, sizes, rotation, currentPage, onSelect }) {
  const rootRef = useRef(null);
  const { near, register, elements } = useNearPages(rootRef, "200px 0px");

  // Keep the current page's preview in view as the reader scrolls the document.
  useEffect(() => {
    const el = elements.current.get(currentPage);
    const root = rootRef.current;
    if (!el || !root) return;
    const button = el.parentElement;
    if (button.offsetTop < root.scrollTop || button.offsetTop + button.offsetHeight > root.scrollTop + root.clientHeight) {
      button.scrollIntoView({ block: "nearest" });
    }
  }, [currentPage, elements]);

  return (
    <div
      ref={rootRef}
      className="relative shrink-0 w-36 overflow-y-auto border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 custom-scrollbar"
    >
      <div className="flex flex-col items-center gap-3 py-3">
        {sizes.map((size, i) => {
          const pageNum = i + 1;
          const selected = pageNum === currentPage;
          return (
            <button
              key={pageNum}
              type="button"
              onClick={() => onSelect(pageNum)}
              title={`Page ${pageNum}`}
              className="group flex flex-col items-center gap-1"
            >
              <PdfPage
                ref={register(pageNum)}
                pdf={pdf}
                pageNum={pageNum}
                scale={THUMB_WIDTH / size.w}
                rotation={rotation}
                size={size}
                active={near.has(pageNum)}
                className={cn(
                  "rounded-sm shadow-sm ring-2 transition-colors",
                  selected ? "ring-primary-500" : "ring-transparent group-hover:ring-gray-300 dark:group-hover:ring-gray-600"
                )}
              />
              <span className={cn("text-[11px]", selected ? "font-semibold text-primary-700 dark:text-primary-300" : "text-gray-500 dark:text-gray-400")}>
                {pageNum}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
