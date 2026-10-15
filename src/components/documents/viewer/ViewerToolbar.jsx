"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// Building blocks for the toolbar of every document viewer (PDF, image, DOCX,
// text, spreadsheet).
//
// By default the toolbar is a row on top of the viewer. A page can instead
// provide a slot (e.g. its header row) through ViewerToolbarHost; the toolbar
// is then portalled into that slot. Either way the toolbar's nearest
// `@container` decides which buttons fit: buttons marked with `collapse`
// ("md" | "lg") hide when there's no room and their ⋮ menu entries appear.
export const ViewerToolbarHost = createContext(null); // { host: HTMLElement | null }

// Container widths below which a collapsible control moves into the ⋮ menu.
// (Class names are spelled out in full so Tailwind generates them.)
const COLLAPSE = {
  md: { button: "hidden @xl:inline-flex", divider: "hidden @xl:block", menu: "@xl:hidden" },    // < 36rem
  lg: { button: "hidden @3xl:inline-flex", divider: "hidden @3xl:block", menu: "@3xl:hidden" }, // < 48rem
};

export function ViewerToolbar({ children, className }) {
  const slot = useContext(ViewerToolbarHost);
  if (slot) {
    if (!slot.host) return null; // slot not mounted yet
    return createPortal(
      <div role="toolbar" className={cn("flex items-center gap-0.5", className)}>{children}</div>,
      slot.host
    );
  }
  return (
    <div className="@container shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <div role="toolbar" className={cn("flex items-center gap-0.5 px-2 h-11 overflow-x-auto no-scrollbar", className)}>
        {children}
      </div>
    </div>
  );
}

export function ToolbarButton({ icon: Icon, label, onClick, active, disabled, busy, collapse, className, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      className={cn(
        "shrink-0 inline-flex items-center justify-center h-8 min-w-8 px-1.5 rounded-md text-gray-600 dark:text-gray-300 transition-colors",
        "hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100",
        "disabled:opacity-40 disabled:pointer-events-none",
        active && "bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300",
        collapse && COLLAPSE[collapse].button,
        className
      )}
    >
      {busy ? (
        <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      ) : Icon ? (
        <Icon className="h-4 w-4" />
      ) : null}
      {children}
    </button>
  );
}

export function ToolbarDivider({ collapse }) {
  return <div className={cn("shrink-0 w-px h-5 mx-1.5 bg-gray-200 dark:bg-gray-700", collapse && COLLAPSE[collapse].divider)} />;
}

export function ToolbarSpacer() {
  return <div className="flex-1 min-w-2" />;
}

// A toolbar button that opens a small dropdown.
// items: [{ label, icon?, onClick, active?, collapse? } | 'divider' | { divider: true, collapse? }].
// An item with `collapse` only shows while the matching toolbar button is hidden.
// The menu is position: fixed so the toolbar's horizontal overflow can't clip it.
export function ToolbarMenu({ icon, label, items, trigger, align = "right" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const anchorRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (anchorRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const toggle = () => {
    if (!open && anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos(align === "right" ? { top: r.bottom + 4, right: window.innerWidth - r.right } : { top: r.bottom + 4, left: r.left });
    }
    setOpen((o) => !o);
  };

  return (
    <div ref={anchorRef} className="shrink-0">
      {trigger ? trigger({ open, toggle }) : <ToolbarButton icon={icon} label={label} onClick={toggle} active={open} />}
      {open && pos && (
        <div
          ref={menuRef}
          role="menu"
          style={pos}
          className="fixed z-50 min-w-44 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg"
        >
          {items.map((item, i) =>
            item === "divider" || item.divider ? (
              <div key={i} className={cn("my-1 h-px bg-gray-100 dark:bg-gray-700", item.collapse && COLLAPSE[item.collapse].menu)} />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); item.onClick(); }}
                disabled={item.disabled}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:pointer-events-none",
                  item.active && "font-medium text-primary-700 dark:text-primary-300",
                  item.collapse && COLLAPSE[item.collapse].menu
                )}
              >
                {item.icon && <item.icon className="h-4 w-4 text-gray-500 dark:text-gray-400" />}
                <span>{item.label}</span>
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// Download + "open in new tab" — shared by every viewer. Download goes through
// /api/documents/[id]/download, which redirects to the stored file with an
// attachment disposition (a plain <a download> can't name a cross-origin file).
export function useDocumentFileActions(docId, fileUrl) {
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const download = () => {
    if (!docId) return;
    const a = document.createElement("a");
    a.href = `/api/documents/${encodeURIComponent(docId)}/download`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const openExternally = () => {
    if (!fileUrl) return setError("The document file isn't available.");
    window.open(fileUrl, "_blank", "noopener");
  };
  return { download, openExternally, error, setError };
}

export function ViewerError({ message }) {
  if (!message) return null;
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-md bg-red-600 text-white text-xs shadow-lg">
      {message}
    </div>
  );
}
