'use client';
import { X } from 'lucide-react';

// Shared title + close-X row for every LeftToolsPanel flyout (Text, Shape,
// Uploads, Background), extracted from UploadsPanel's original inline
// header so it isn't duplicated 4 times.
// Ported verbatim.
export default function PanelHeader({ title, onClose }) {
  return (
    <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h3>
      <button
        type="button"
        onClick={onClose}
        title="Close"
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
