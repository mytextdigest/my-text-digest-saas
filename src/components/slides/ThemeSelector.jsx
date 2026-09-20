'use client';
import { Check, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

function Swatch({ colors, isActive, isApplying, disabled, onClick, title, icon }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        'relative aspect-square rounded-lg border-2 overflow-hidden transition-all disabled:cursor-not-allowed disabled:opacity-60',
        isActive
          ? 'border-primary-500 ring-2 ring-primary-500/40'
          : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600 hover:scale-105'
      )}
      style={{ background: `linear-gradient(135deg, #${colors.primary} 50%, #${colors.secondary} 50%)` }}
    >
      <span
        className="absolute bottom-1 right-1 w-2 h-2 rounded-full border border-white/70"
        style={{ backgroundColor: `#${colors.accent}` }}
      />
      {icon && !isApplying && (
        <span className="absolute top-1 left-1 text-white drop-shadow">{icon}</span>
      )}
      {isApplying ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
        </span>
      ) : isActive ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/10">
          <Check className="w-3.5 h-3.5 text-white drop-shadow" />
        </span>
      ) : null}
      <span className="sr-only">{title}</span>
    </button>
  );
}

// A grid of palette swatches — each one applies instantly (no LLM round
// trip) since a deck's whole color scheme is a single field every layout
// derives its colors from at render time (src/lib/slides/theme.js).
// `brandColors`/`isBrandActive`/`onSelectBrand` (all optional) add a pinned
// "Your Brand" swatch above the 10 presets when this deck was generated with
// a brand kit — kept visually separate rather than folded in as an 11th
// preset, since it's a different kind of choice (identity vs. aesthetic
// experimentation) and should stay findable after trying a preset.
// Ported verbatim.
export default function ThemeSelector({
  palettes, activePaletteName, onSelect, disabled, applyingName,
  brandColors, isBrandActive, onSelectBrand,
}) {
  return (
    <div className="p-3 border-b border-gray-200 dark:border-gray-700">
      {brandColors && (
        <div className="mb-3">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Your Brand
          </h3>
          <div className="w-14">
            <Swatch
              colors={brandColors}
              isActive={isBrandActive}
              isApplying={applyingName === '__brand__'}
              disabled={disabled}
              onClick={onSelectBrand}
              title="Your Brand"
              icon={<Sparkles className="w-2.5 h-2.5" />}
            />
          </div>
        </div>
      )}
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
        {brandColors ? 'Presets' : 'Color Theme'}
      </h3>
      <div className="grid grid-cols-5 gap-2">
        {Object.entries(palettes).map(([name, colors]) => (
          <Swatch
            key={name}
            colors={colors}
            isActive={!isBrandActive && name === activePaletteName}
            isApplying={applyingName === name}
            disabled={disabled}
            onClick={() => onSelect(name)}
            title={name}
          />
        ))}
      </div>
    </div>
  );
}
