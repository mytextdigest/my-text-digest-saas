'use client';
import { useRef } from 'react';
import { X, Loader2, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';
import PanelHeader from './PanelHeader';

// Canva-style "Background color" flyout — every swatch applies
// onSetBackground(...) immediately (live); there's no separate "confirm"
// step. `backgroundColor` is either a solid hex string or a 2-stop
// gradient descriptor { type: 'gradient', angle, stops: [hexA, hexB] } —
// see src/lib/slides/elements.js's validateBackgroundColor.
// Ported verbatim.
const DEFAULT_COLORS = [
  '000000', '404040', '737373', 'A3A3A3', 'D4D4D4', 'FFFFFF',
  'EF4444', 'F97316', 'EAB308', '22C55E', '14B8A6', '3B82F6', '6366F1', 'A855F7', 'EC4899',
];

// Curated 2-stop gradients (no custom gradient editor in this pass). PPTX
// export has no native gradient fill support at all, so these are
// rasterized to a PNG background image at export time instead — see
// src/lib/slides/gradientRaster.js's gradientToBase64Png.
const DEFAULT_GRADIENTS = [
  { angle: 135, stops: ['434343', '000000'] },
  { angle: 135, stops: ['FF512F', 'DD2476'] },
  { angle: 135, stops: ['FF9A00', 'FF3D77'] },
  { angle: 135, stops: ['F7971E', 'FFD200'] },
  { angle: 135, stops: ['11998E', '38EF7D'] },
  { angle: 135, stops: ['00C6FF', '0072FF'] },
  { angle: 135, stops: ['4E54C8', '8F94FB'] },
  { angle: 135, stops: ['A18CD1', 'FBC2EB'] },
  { angle: 135, stops: ['FBC2EB', 'A6C1EE'] },
  { angle: 135, stops: ['667EEA', '764BA2'] },
];

function Swatch({ hex, active, onClick, disabled, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title || `#${hex}`}
      className={cn(
        'w-7 h-7 rounded-full border transition-shadow',
        active ? 'ring-2 ring-offset-1 ring-violet-500 border-transparent' : 'border-gray-200 dark:border-gray-700',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      style={{ background: `#${hex}` }}
    />
  );
}

function GradientSwatch({ angle, stops, active, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`Gradient #${stops[0]} → #${stops[1]}`}
      className={cn(
        'w-7 h-7 rounded-full border transition-shadow',
        active ? 'ring-2 ring-offset-1 ring-violet-500 border-transparent' : 'border-gray-200 dark:border-gray-700',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      style={{ background: `linear-gradient(${angle}deg, #${stops[0]}, #${stops[1]})` }}
    />
  );
}

export default function BackgroundPanel({ backgroundColor, onSetBackground, brandColors, saving, disabled, onClose }) {
  const colorInputRef = useRef(null);
  const isDisabled = disabled || saving;
  const solidColor = typeof backgroundColor === 'string' ? backgroundColor : null;
  const gradientColor = backgroundColor && typeof backgroundColor === 'object' && backgroundColor.type === 'gradient' ? backgroundColor : null;
  const normalizedBrandColors = Array.isArray(brandColors)
    ? brandColors.map((c) => (typeof c === 'string' ? c.replace('#', '').toUpperCase() : null)).filter(Boolean)
    : [];

  return (
    <div className="w-72 shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-white dark:bg-gray-900">
      <PanelHeader title="Background color" onClose={onClose} />

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
        <div>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Custom color</h4>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => colorInputRef.current?.click()}
                disabled={isDisabled}
                title={solidColor ? `Background: #${solidColor}` : 'Pick a custom color'}
                className={cn(
                  'w-10 h-10 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center',
                  isDisabled && 'opacity-50 cursor-not-allowed'
                )}
                style={solidColor ? { background: `#${solidColor}` } : undefined}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : !solidColor && <Palette className="w-4 h-4 text-gray-400" />}
              </button>
              <input
                ref={colorInputRef}
                type="color"
                value={`#${solidColor || 'FAFAFA'}`}
                onChange={(e) => onSetBackground(e.target.value.replace('#', '').toUpperCase())}
                disabled={isDisabled}
                className="sr-only"
                tabIndex={-1}
              />
            </div>
            {backgroundColor && (
              <button
                type="button"
                onClick={() => onSetBackground(null)}
                disabled={isDisabled}
                title="Reset to theme default background"
                className="text-xs font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-0.5"
              >
                <X className="w-3 h-3" /> Reset
              </button>
            )}
          </div>
        </div>

        {normalizedBrandColors.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Brand Kit</h4>
            <div className="flex flex-wrap gap-2">
              {normalizedBrandColors.map((hex) => (
                <Swatch
                  key={hex}
                  hex={hex}
                  active={solidColor === hex}
                  onClick={() => onSetBackground(hex)}
                  disabled={isDisabled}
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Default colors</h4>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_COLORS.map((hex) => (
              <Swatch
                key={hex}
                hex={hex}
                active={solidColor === hex}
                onClick={() => onSetBackground(hex)}
                disabled={isDisabled}
              />
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Default gradients</h4>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_GRADIENTS.map(({ angle, stops }) => (
              <GradientSwatch
                key={`${stops[0]}-${stops[1]}`}
                angle={angle}
                stops={stops}
                active={!!gradientColor && gradientColor.angle === angle && gradientColor.stops[0] === stops[0] && gradientColor.stops[1] === stops[1]}
                onClick={() => onSetBackground({ type: 'gradient', angle, stops })}
                disabled={isDisabled}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
