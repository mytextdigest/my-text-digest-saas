'use client';
import { Minus } from 'lucide-react';
import PanelHeader from './PanelHeader';

// Canva-style "Shapes" flyout — each swatch is styled with the shape's own
// default fill (matching src/lib/slides/elements.js's
// DEFAULT_ELEMENT_BY_KIND) rather than a generic lucide icon, so it
// previews what actually gets inserted.
// Ported verbatim.
const SHAPE_KINDS = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'line', label: 'Line' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
  { kind: 'star', label: 'Star' },
  { kind: 'rightArrow', label: 'Arrow' },
  { kind: 'roundRect', label: 'Rounded rectangle' },
  { kind: 'octagon', label: 'Octagon' },
  { kind: 'parallelogram', label: 'Parallelogram' },
];

// CSS clip-path equivalents of SlideRenderer.jsx's SHAPE_POLYGON_POINTS
// (same shapes, expressed in each format's own syntax — clip-path is fine
// for these static, strokeless preview swatches; the actual canvas element
// uses SVG instead, since a CSS border after clip-path doesn't correctly
// outline a clipped shape, and these swatches never need a stroke).
const SHAPE_CLIP_PATHS = {
  triangle: 'polygon(50% 0%, 0% 100%, 100% 100%)',
  diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  pentagon: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)',
  hexagon: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
  star: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
  rightArrow: 'polygon(0% 25%, 60% 25%, 60% 0%, 100% 50%, 60% 100%, 60% 75%, 0% 75%)',
  octagon: 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)',
  parallelogram: 'polygon(25% 0%, 100% 0%, 75% 100%, 0% 100%)',
};

export default function ShapesPanel({ onAddShape, disabled, onClose }) {
  return (
    <div className="w-72 shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-white dark:bg-gray-900">
      <PanelHeader title="Shapes" onClose={onClose} />

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <div className="grid grid-cols-3 gap-2">
          {SHAPE_KINDS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              onClick={() => onAddShape?.(kind)}
              disabled={disabled}
              title={label}
              className="aspect-square rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {kind === 'rect' && <div className="w-9 h-7 rounded-sm" style={{ background: '#CADCFC' }} />}
              {kind === 'ellipse' && <div className="w-8 h-8 rounded-full" style={{ background: '#CADCFC' }} />}
              {kind === 'line' && <Minus className="w-9 h-9 text-gray-700 dark:text-gray-300" strokeWidth={2} />}
              {kind === 'roundRect' && <div className="w-9 h-7 rounded-md" style={{ background: '#CADCFC' }} />}
              {SHAPE_CLIP_PATHS[kind] && (
                <div className="w-9 h-9" style={{ background: '#CADCFC', clipPath: SHAPE_CLIP_PATHS[kind] }} />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
