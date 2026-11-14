"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ToolbarMenu } from "@/components/documents/viewer/ViewerToolbar";
import { cn } from "@/lib/utils";

const GAP = 4; // gap-1

function TabButton({ tab: { id, label, icon: Icon, count }, active, onClick, tabIndex }) {
  return (
    <Button
      role="tab"
      aria-selected={active}
      variant={active ? 'default' : 'ghost'}
      size="sm"
      onClick={onClick}
      tabIndex={tabIndex}
      className={cn(
        "shrink-0 flex items-center gap-2 whitespace-nowrap",
        active ? "text-white dark:text-gray-200" : "text-gray-600 dark:text-gray-400"
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {count > 0 && (
        <span className={cn(
          "min-w-5 h-5 px-1.5 inline-flex items-center justify-center text-[11px] font-medium rounded-full",
          active ? "bg-white/20" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
        )}>
          {count}
        </span>
      )}
    </Button>
  );
}

function MoreButton({ open, onClick, tabIndex }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      tabIndex={tabIndex}
      aria-haspopup="menu"
      aria-expanded={open}
      className={cn(
        "shrink-0 flex items-center gap-1 whitespace-nowrap text-gray-600 dark:text-gray-400",
        open && "bg-gray-100 dark:bg-gray-800"
      )}
    >
      <span>More</span>
      <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
    </Button>
  );
}

// Which tabs fit in `available` px: as many as possible in order, keeping the
// active one in the row (it takes the last visible spot if it would overflow).
function fitTabs(tabs, widths, moreWidth, available, activeTab) {
  const total = widths.reduce((sum, w) => sum + w, 0) + GAP * (widths.length - 1);
  if (total <= available) return tabs.map((t) => t.id);

  const budget = available - moreWidth - GAP;
  const activeIndex = tabs.findIndex((t) => t.id === activeTab);
  const shown = [];
  let used = activeIndex >= 0 ? widths[activeIndex] : 0;
  tabs.forEach((t, i) => {
    if (i === activeIndex) return;
    if (used + GAP + widths[i] <= budget) {
      used += GAP + widths[i];
      shown.push(i);
    }
  });
  if (activeIndex >= 0) shown.push(activeIndex);
  // Keep the original order, but stop at the first gap so the row reads left to
  // right (the active tab is the only one allowed to jump ahead).
  const ordered = shown.sort((a, b) => a - b);
  const firstSkipped = tabs.findIndex((_, i) => !ordered.includes(i));
  return ordered
    .filter((i) => i < firstSkipped || i === activeIndex)
    .map((i) => tabs[i].id);
}

// Tab bar for the document and project pages' right panel.
// tabs: [{ id, label, icon, count? }]. Shows as many tabs as fit on one row;
// the rest go into a "More" menu. The active tab is always in the row.
export default function DocumentTabs({ tabs, activeTab, onChange }) {
  const rootRef = useRef(null);
  const measureRef = useRef(null);
  const [visibleIds, setVisibleIds] = useState(null); // null = not measured yet → show all

  const signature = tabs.map((t) => `${t.id}:${t.label}:${t.count ?? 0}`).join("|");

  useLayoutEffect(() => {
    const root = rootRef.current;
    const measure = measureRef.current;
    if (!root || !measure) return;
    const update = () => {
      const nodes = Array.from(measure.children);
      const widths = nodes.slice(0, tabs.length).map((n) => n.offsetWidth);
      const moreWidth = nodes[tabs.length]?.offsetWidth ?? 0;
      const next = fitTabs(tabs, widths, moreWidth, root.clientWidth, activeTab);
      setVisibleIds((prev) => (prev && prev.join() === next.join() ? prev : next));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(root);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, activeTab]);

  const visible = visibleIds ? tabs.filter((t) => visibleIds.includes(t.id)) : tabs;
  const hidden = visibleIds ? tabs.filter((t) => !visibleIds.includes(t.id)) : [];

  return (
    <div ref={rootRef} className="relative min-w-0">
      {/* Off-screen copy of every tab (and the More button) at natural width, for measuring. */}
      <div aria-hidden className="absolute inset-0 overflow-hidden invisible pointer-events-none">
        <div ref={measureRef} className="flex w-max gap-1">
          {tabs.map((t) => <TabButton key={t.id} tab={t} active={t.id === activeTab} tabIndex={-1} />)}
          <MoreButton tabIndex={-1} />
        </div>
      </div>

      <div role="tablist" className="flex items-center gap-1 overflow-hidden">
        {visible.map((t) => (
          <TabButton key={t.id} tab={t} active={t.id === activeTab} onClick={() => onChange(t.id)} />
        ))}
        {hidden.length > 0 && (
          <ToolbarMenu
            align="right"
            items={hidden.map((t) => ({
              label: t.count > 0 ? `${t.label} (${t.count})` : t.label,
              icon: t.icon,
              onClick: () => onChange(t.id),
            }))}
            trigger={({ open, toggle }) => <MoreButton open={open} onClick={toggle} />}
          />
        )}
      </div>
    </div>
  );
}
