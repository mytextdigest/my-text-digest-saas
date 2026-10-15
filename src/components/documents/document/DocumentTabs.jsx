"use client";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

// Tab bar for the document page's right panel. tabs: [{ id, label, icon, count? }].
// Stays on one row and scrolls sideways when the panel is narrow.
export default function DocumentTabs({ tabs, activeTab, onChange }) {
  return (
    <div role="tablist" className="flex items-center gap-1 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5">
      {tabs.map(({ id, label, icon: Icon, count }) => {
        const active = activeTab === id;
        return (
          <Button
            key={id}
            role="tab"
            aria-selected={active}
            variant={active ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onChange(id)}
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
      })}
    </div>
  );
}
