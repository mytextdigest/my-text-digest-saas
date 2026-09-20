'use client';
import { Type } from 'lucide-react';
import { cn } from '@/lib/utils';
import PanelHeader from './PanelHeader';

// Canva-style "Text" flyout — reports which preset was picked via
// onAddText(presetKey); SlideDeckEditor owns the actual default-object
// mapping (TEXT_PRESET_DEFAULTS), same ownership split UploadsPanel already
// uses for onInsertImage. Stays open after an insert so several text boxes
// can be added without reopening the panel.
// Ported verbatim.
export default function TextPanel({ onAddText, disabled, onClose }) {
  return (
    <div className="w-72 shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-white dark:bg-gray-900">
      <PanelHeader title="Text" onClose={onClose} />

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
        <button
          type="button"
          onClick={() => onAddText?.('default')}
          disabled={disabled}
          className={cn(
            'w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
            disabled
              ? 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
              : 'bg-violet-600 hover:bg-violet-700 text-white'
          )}
        >
          <Type className="w-4 h-4" />
          Add a text box
        </button>

        <div>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Default text styles</h4>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => onAddText?.('heading')}
              disabled={disabled}
              className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2.5 text-xl font-bold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add a heading
            </button>
            <button
              type="button"
              onClick={() => onAddText?.('subheading')}
              disabled={disabled}
              className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2.5 text-base font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add a subheading
            </button>
            <button
              type="button"
              onClick={() => onAddText?.('body')}
              disabled={disabled}
              className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add a little bit of body text
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
