'use client';
import { cn } from '@/lib/utils';
import { SLIDE_W, SLIDE_H } from '@/lib/slides/theme.js';
import SlideRenderer from '../renderer/SlideRenderer';
import { useElementSize } from './usePresentation';

// A slide scaled to fit (letterboxed, never cropped) inside whatever box it's
// given. `screen` blacks/whites it out, `pointer` ({x, y} in 0–1 slide
// coordinates) draws the laser dot, and `onPointer` reports the mouse
// position over the slide in the same coordinates (null when it leaves).
export default function SlideStage({
  slide, theme, slideIndex, screen = 'normal', pointer = null, onPointer, className, frameClassName, children,
}) {
  const [ref, size] = useElementSize();
  const scale = size.width && size.height ? Math.min(size.width / SLIDE_W, size.height / SLIDE_H) : 0;
  const w = scale * SLIDE_W;
  const h = scale * SLIDE_H;

  const handleMove = onPointer
    ? (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onPointer({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
      }
    : undefined;

  return (
    <div ref={ref} className={cn('relative flex items-center justify-center min-w-0 min-h-0 overflow-hidden', className)}>
      {scale > 0 && (
        <div
          data-slide-frame
          className={cn('relative overflow-hidden', frameClassName)}
          style={{ width: w, height: h }}
          onMouseMove={handleMove}
          onMouseLeave={onPointer ? () => onPointer(null) : undefined}
        >
          {slide && theme && <SlideRenderer slide={slide} theme={theme} scale={scale} slideIndex={slideIndex} />}
          {screen !== 'normal' && (
            <div className={cn('absolute inset-0', screen === 'black' ? 'bg-black' : 'bg-white')} />
          )}
          {pointer && screen === 'normal' && (
            <span
              aria-hidden
              className="absolute w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full bg-red-500 ring-4 ring-red-500/30 shadow-[0_0_12px_4px_rgba(239,68,68,0.6)] pointer-events-none"
              style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }}
            />
          )}
          {children}
        </div>
      )}
    </div>
  );
}
