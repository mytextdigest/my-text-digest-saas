'use client';
import { Type, Shapes, ImagePlus, PaintBucket } from 'lucide-react';
import { cn } from '@/lib/utils';

const TOOLS = [
  { key: 'text', label: 'Text', icon: Type, title: 'Text' },
  { key: 'shape', label: 'Shape', icon: Shapes, title: 'Shapes' },
  { key: 'uploads', label: 'Uploads', icon: ImagePlus, title: 'Uploads' },
  { key: 'background', label: 'Background', icon: PaintBucket, title: 'Background color' },
];

// Canva-style left tool rail — a pure icon-rail selector, no internal state
// of its own. Every tool opens the same kind of sibling flyout panel
// (TextPanel/ShapesPanel/UploadsPanel/BackgroundPanel, rendered by
// SlideDeckEditor based on `activeTool`) where the actual insert/edit
// happens — this component only reports clicks upward via onSelectTool.
//
// Ported verbatim from electron/slides — pure React/CSS, no Electron API.
export default function LeftToolsPanel({ activeTool, onSelectTool, disabled }) {
  return (
    <div className="w-16 shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col items-center gap-1 py-3">
      {TOOLS.map(({ key, label, icon: Icon, title }) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelectTool?.(key)}
          disabled={disabled}
          title={title}
          className={cn(
            'w-12 h-12 flex flex-col items-center justify-center gap-1 rounded-lg transition-colors',
            disabled
              ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50'
              : activeTool === key
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          )}
        >
          <Icon className="w-4 h-4" />
          <span className="text-[9px] font-medium leading-none">{label}</span>
        </button>
      ))}
    </div>
  );
}
