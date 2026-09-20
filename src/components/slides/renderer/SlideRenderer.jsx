// Browser-side preview renderer for generated slide decks. Mirrors
// src/lib/slides/layouts.js's positioning math exactly (same constants,
// same formulas, imported directly from src/lib/slides/theme.js) but
// outputs absolutely-positioned HTML/CSS instead of PptxGenJS shape/text
// calls. Deliberately NOT pixel-identical to the exported .pptx — text
// wrapping, font availability, and shadow rendering will differ slightly
// between the browser and PowerPoint; the exported file remains the
// authoritative output. Native PptxGenJS charts are approximated with
// recharts. See src/lib/slides/layouts.js for the source of truth this
// mirrors — keep both in sync when one changes.
//
// Ported near-verbatim from electron/slides/renderer/SlideRenderer.jsx —
// pure React/CSS/math, zero Electron API usage, so only the theme.js import
// path changes.
'use client';

import { useEffect, useRef, useState } from 'react';
import Moveable from 'react-moveable';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  SLIDE_W, SLIDE_H, MARGIN, TYPE_SCALE, contrastText, rotatingColor, ensureReadableOnLight, mixHex, getStyle, PLAIN_STYLE, HERO_IMAGE_PANEL_W,
} from '@/lib/slides/theme.js';
import { SlideIcon } from './icons';

const CONTENT_X = MARGIN;
const CONTENT_W = SLIDE_W - MARGIN * 2;
const TITLE_Y = 0.5;
const TITLE_H = 0.9;
const BODY_Y = 1.6;
const BODY_H = SLIDE_H - BODY_Y - MARGIN;
const MUTED = '64748B';
const LIGHT_BG = 'FAFAFA';
const CARD_BG = 'FFFFFF';
const CARD_BORDER = 'E5E7EB';
// Matches src/lib/slides/layouts.js's own CARD_RADIUS constant exactly (in
// inches) — a card's default corner radius before any layoutOverrides.radius
// override.
const CARD_RADIUS = 0.12;
// Mirrors src/lib/slides/layouts.js's MAX_BULLETS_TOP_GAP exactly — caps how
// far a short bullet/two_column list gets vertically centered within BODY_H,
// so a handful of one-line bullets doesn't float with a large empty gap both
// above and below it.
const MAX_BULLETS_TOP_GAP = 1.0;

const DARK_TYPES = new Set(['title', 'section_header', 'quote', 'closing']);
const CARD_SHADOW_CSS = '0 2px 6px rgba(0,0,0,0.15)';
// Mirrors src/lib/slides/layouts.js's warmFillColor exactly (mixed from
// palette.primary, not secondary — several palettes keep secondary
// intentionally near-white, which made the tint imperceptible on exactly
// those palettes; primary is a strong, non-pale anchor on every palette).
function warmFillColor(theme) {
  return mixHex(theme.palette.primary, 'FFFFFF', 0.85);
}
// Mirrors src/lib/slides/layouts.js's CARD_DRAWING_SHAPES/cardChromeFor —
// kept as CSS style fragments (border/background strings) instead of
// PptxGenJS option objects, but the same three-shape decision. "outline"
// (added for the "minimal" preset): no background, a slightly bolder border
// in the theme's own primary color, no shadow.
const CARD_DRAWING_SHAPES = new Set(['bold', 'warm', 'outline']);
function cardChromeFor(theme, style) {
  if (style.shape === 'outline') {
    return { background: 'transparent', border: `1.5px solid ${hex(ensureReadableOnLight(theme.palette.primary))}`, boxShadow: undefined };
  }
  if (style.shape === 'warm') {
    return { background: hex(warmFillColor(theme)), border: `1px solid ${hex(CARD_BORDER)}`, boxShadow: CARD_SHADOW_CSS };
  }
  return { background: hex(CARD_BG), border: `1px solid ${hex(CARD_BORDER)}`, boxShadow: CARD_SHADOW_CSS };
}
// Basic-shape kinds rendered as an inline SVG <polygon> in a 0-100 viewBox
// (see FreeformElement below) — a plain CSS clip-path on a bordered div
// doesn't work here, since the border would still draw along the original
// rectangular box and only survive in fragments after clipping, not as a
// clean outline of the visible shape. Coordinates match
// src/lib/slides/layouts.js's PptxGenJS shape-type mapping
// (freeformShapeType) for each kind.
const SHAPE_POLYGON_POINTS = {
  triangle: '50,0 0,100 100,100',
  diamond: '50,0 100,50 50,100 0,50',
  pentagon: '50,0 100,38 82,100 18,100 0,38',
  hexagon: '25,0 75,0 100,50 75,100 25,100 0,50',
  star: '50,0 61,35 98,35 68,57 79,91 50,70 21,91 32,57 2,35 39,35',
  rightArrow: '0,25 60,25 60,0 100,50 60,100 60,75 0,75',
  octagon: '30,0 70,0 100,30 100,70 70,100 30,100 0,70 0,30',
  parallelogram: '25,0 100,0 75,100 0,100',
};
// Fixed radius (inches) for the roundRect freeform shape — a plain div with
// borderRadius, same treatment as ellipse's 50%, not an SVG shape.
const SHAPE_ROUND_RADIUS = 0.15;

// px = inches * scale (scale is px-per-inch, so the same helper drives both
// the small thumbnail rail and the large main preview — only `scale` differs).
function inch(n, scale) { return n * scale; }
// PptxGenJS font sizes are in points (1pt = 1/72in) — convert through inches
// so it scales consistently with every other position/size.
function pt(n, scale) { return (n / 72) * scale; }
function hex(c) { return c ? `#${c}` : undefined; }

// `editable`/`onCommit` (optional) turn this into a click-directly-and-type
// field — the whole point of editing the deck's own template text in place.
// Uncontrolled while editing: the browser owns the DOM text during the
// edit, `onCommit` only reads it back on blur — keeping it controlled via
// React state on every keystroke is what causes the classic
// contentEditable-cursor-jumps-to-start bug.
//
// Adds an optional position override: `fieldPath` + `layoutCtx` (an object
// — see the root SlideRenderer export below — bundling `overrides` (this
// slide's `layoutOverrides` map, always read regardless of interactivity,
// so a moved/resized/rotated field stays that way in thumbnails/
// presentation too), plus the interactive-only selection state/handlers).
// Each of `layoutCtx.overrides[fieldPath]`'s x/y/w/h/rotation fields
// independently replaces the caller's computed default for that field — a
// resize-only override doesn't need to also carry x/y, and vice versa.
// Selection vs. editing mirrors FreeformElement's split exactly: a first
// click selects (shows the outline + react-moveable drag/resize/rotate
// handles), a second click on the already-selected field (or a
// double-click) starts editing it.
//
// `interactiveTransform` (default true) — set false for a field that must
// stay selectable/editable but never drag/resize/rotate independently of a
// larger container it's nested in (TableSlide's per-cell TextBoxes, which
// move/resize only as part of the whole table). Select/edit-mode logic is
// unchanged either way; only the <Moveable> handles are skipped.
function TextBox({
  x, y, w, h, scale, fontSize, fontFamily, color, bold, italic, align = 'left', valign = 'top', children, style,
  editable, onCommit, fieldPath, layoutCtx, listMarker = false, interactiveTransform = true,
}) {
  if (children === undefined || children === null || children === '') return null;
  const ref = useRef(null);
  // Whether the CURRENT resize gesture (if any) is locking aspect ratio —
  // set from onResizeStart's `direction` (corner vs. edge), read back in
  // onResize/onResizeEnd. Set as component state (not a plain variable)
  // specifically so Moveable's `keepRatio` prop reflects it for the live
  // gesture: Moveable only preserves aspect ratio while its own `keepRatio`
  // prop is true, so this has to flip before the drag's first resize event,
  // which onResizeStart firing synchronously on pointer-down guarantees.
  const [keepRatio, setKeepRatio] = useState(false);
  const override = fieldPath ? layoutCtx?.overrides?.[fieldPath] : null;
  const effX = override?.x ?? x;
  const effY = override?.y ?? y;
  const effW = override?.w ?? w;
  const effH = override?.h ?? h;
  const effRotation = override?.rotation ?? 0;
  // fontSize/color/bold/italic/align overrides — same style fields the
  // freeform text toolbar already exposes for `elements[]`, so template text
  // can go through the identical floating toolbar in SlideDeckEditor.jsx
  // instead of feeling like a second-class, style-locked text type.
  const effFontSize = override?.fontSize ?? fontSize;
  const effColor = override?.color ?? color;
  const effBold = override?.bold ?? bold;
  const effItalic = override?.italic ?? italic;
  const effAlign = override?.align ?? align;
  const selected = !!(editable && fieldPath && layoutCtx?.selectedFieldPath === fieldPath);
  const isEditing = !!(editable && fieldPath && layoutCtx?.editingFieldPath === fieldPath);

  useEffect(() => {
    if (!isEditing || !ref.current) return;
    ref.current.focus();
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  const justify = effAlign === 'center' ? 'center' : effAlign === 'right' ? 'flex-end' : 'flex-start';
  const items = valign === 'middle' ? 'center' : valign === 'bottom' ? 'flex-end' : 'flex-start';
  const commonStyle = {
    position: 'absolute', left: inch(effX, scale), top: inch(effY, scale), width: inch(effW, scale), height: inch(effH, scale),
    transform: effRotation ? `rotate(${effRotation}deg)` : undefined,
    ...(listMarker
      ? { display: 'list-item', listStyleType: 'disc', listStylePosition: 'inside' }
      : { display: 'flex', flexDirection: 'column', justifyContent: items, alignItems: justify }),
    textAlign: effAlign, overflow: 'hidden', boxSizing: 'border-box',
    fontSize: pt(effFontSize, scale), fontFamily, color: hex(effColor),
    fontWeight: effBold ? 700 : 400, fontStyle: effItalic ? 'italic' : 'normal', lineHeight: 1.25,
    whiteSpace: 'pre-wrap',
    outline: selected ? '2px solid #3B82F6' : undefined, outlineOffset: selected ? 2 : undefined,
    ...style,
  };

  if (!editable) {
    return <div style={commonStyle}>{children}</div>;
  }

  // The field's inherent style before any override — passed along on
  // selection so SlideDeckEditor's floating text toolbar has something to
  // fall back on for whichever of fontSize/color/bold/italic/align isn't
  // already overridden (mirrors how a freeform text element always carries
  // its own full style, just split here between computed-default and
  // override since template fields don't store style directly on the slide).
  const fieldDefaults = { kind: 'text', fontSize, color, bold, italic, align };

  // First click selects; a second click on an already-selected field (or a
  // double-click) starts editing it — same pattern as FreeformElement.
  const handleClick = (e) => {
    e.stopPropagation();
    if (!fieldPath || !layoutCtx) return;
    if (!selected) {
      layoutCtx.onSelectField?.(fieldPath, fieldDefaults);
    } else if (!isEditing) {
      layoutCtx.onStartEditingField?.(fieldPath, fieldDefaults);
    }
  };
  const handleDoubleClick = (e) => {
    e.stopPropagation();
    if (!fieldPath || !layoutCtx) return;
    layoutCtx.onSelectField?.(fieldPath, fieldDefaults);
    layoutCtx.onStartEditingField?.(fieldPath, fieldDefaults);
  };

  return (
    <>
      <div
        ref={ref}
        data-field-path={fieldPath}
        contentEditable={isEditing}
        suppressContentEditableWarning={isEditing}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onBlur={isEditing ? (e) => onCommit?.(e.currentTarget.textContent || '') : undefined}
        style={{ ...commonStyle, cursor: isEditing ? 'text' : selected && interactiveTransform ? 'move' : 'text' }}
      >
        {children}
      </div>
      {selected && !isEditing && interactiveTransform && (
        <Moveable
          target={ref}
          draggable
          resizable
          rotatable
          origin={false}
          keepRatio={keepRatio}
          throttleRotate={1}
          onDrag={({ target, left, top }) => {
            target.style.left = `${left}px`;
            target.style.top = `${top}px`;
          }}
          onDragEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const nx = (parseFloat(target.style.left) || 0) / scale;
            const ny = (parseFloat(target.style.top) || 0) / scale;
            layoutCtx.onCommitFieldOverride?.(fieldPath, { x: nx, y: ny });
          }}
          // A CORNER handle locks aspect ratio for this gesture (via
          // `keepRatio` above, flipped here before Moveable computes its
          // first resize frame) so a "grow" drag enlarges width AND height
          // together instead of letting the box get arbitrarily distorted —
          // an earlier version tried to reverse-engineer a single fontSize
          // from an already-distorted box (area ratio, then min(w,h) ratio)
          // and both failed: area-based over-grew the font past what a
          // width-dominant drag's HEIGHT could fit (text got clipped by this
          // box's `overflow: hidden`); min-based then barely grew the font at
          // all on that same width-dominant drag, since the near-unchanged
          // height ratio always won. Locking the ratio up front avoids the
          // ambiguity entirely — width/height grow proportionally, so a
          // single scale factor is well-defined. A side/edge handle leaves
          // keepRatio false, so it still only changes that one dimension
          // (rewraps text, no font change).
          onResizeStart={({ direction }) => {
            setKeepRatio(direction[0] !== 0 && direction[1] !== 0);
          }}
          onResize={({ target, width, height, drag }) => {
            const minW = scale * 0.3;
            const minH = scale * 0.2;
            target.style.width = `${Math.max(minW, width)}px`;
            target.style.height = `${Math.max(minH, height)}px`;
            target.style.left = `${drag.left}px`;
            target.style.top = `${drag.top}px`;
          }}
          onResizeEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const nw = (parseFloat(target.style.width) || 0) / scale;
            const nh = (parseFloat(target.style.height) || 0) / scale;
            const nx = (parseFloat(target.style.left) || 0) / scale;
            const ny = (parseFloat(target.style.top) || 0) / scale;
            const patch = { x: nx, y: ny, w: nw, h: nh };
            if (keepRatio && effW > 0 && effH > 0) {
              const scaleRatio = ((nw / effW) + (nh / effH)) / 2;
              patch.fontSize = Math.max(6, Math.min(200, Math.round(effFontSize * scaleRatio)));
            }
            setKeepRatio(false);
            layoutCtx.onCommitFieldOverride?.(fieldPath, patch);
          }}
          onRotate={({ target, rotate }) => {
            target.style.transform = `rotate(${rotate}deg)`;
          }}
          onRotateEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const match = /rotate\(([-\d.]+)deg\)/.exec(target.style.transform || '');
            const raw = match ? parseFloat(match[1]) : 0;
            const normalized = Math.round(((raw + 180) % 360 + 360) % 360 - 180);
            layoutCtx.onCommitFieldOverride?.(fieldPath, { rotation: normalized });
          }}
        />
      )}
    </>
  );
}

// `radius` is in INCHES (same unit x/y/w/h already use), not raw CSS px —
// matches how src/lib/slides/layouts.js's pptxgenjs `rectRadius` option is
// actually interpreted (an absolute inch value, confirmed from its own
// source: `rectRadius * EMU / min(cx, cy)`), so a radius override round-trips
// identically between the live preview and the exported .pptx. Every
// card/panel call site passing a literal `radius` prop (not an override)
// uses `CARD_RADIUS` (0.12in) to match layouts.js's own constant of the
// same name.
//
// Selectable/draggable/resizable(free, NOT aspect-locked — unlike
// InteractiveCircle, a card has no font to keep matched to its shape, so
// every handle just resizes independently, same as FreeformElement's own
// rect/ellipse kinds)/rotatable when `fieldPath`+`interactive` are given, via
// the same layoutCtx/`onCommitFieldOverride` plumbing as TextBox and
// InteractiveCircle. No edit mode (nothing to type into). Omitting `radius`
// entirely (the timeline connector line) means the field doesn't support a
// radius override — see the `kind: 'shape'` fieldDefaults check below, which
// only attaches a radius control to fields that actually pass one.
function Shape({ x, y, w, h, scale, fill, border, radius, shadow, fieldPath, layoutCtx, interactive }) {
  const ref = useRef(null);
  const override = fieldPath ? layoutCtx?.overrides?.[fieldPath] : null;
  const effX = override?.x ?? x;
  const effY = override?.y ?? y;
  const effW = override?.w ?? w;
  const effH = override?.h ?? h;
  const effRotation = override?.rotation ?? 0;
  const effRadius = override?.radius ?? radius;
  const selected = !!(interactive && fieldPath && layoutCtx?.selectedFieldPath === fieldPath);

  const commonStyle = {
    position: 'absolute', left: inch(effX, scale), top: inch(effY, scale), width: inch(effW, scale), height: inch(effH, scale),
    transform: effRotation ? `rotate(${effRotation}deg)` : undefined,
    background: fill, border, borderRadius: effRadius ? inch(effRadius, scale) : undefined,
    boxShadow: shadow ? CARD_SHADOW_CSS : undefined,
    boxSizing: 'border-box',
  };

  if (!interactive || !fieldPath) {
    return <div style={commonStyle} />;
  }

  const handleClick = (e) => {
    e.stopPropagation();
    const fieldDefaults = radius !== undefined ? { kind: 'shape', radius } : undefined;
    layoutCtx?.onSelectField?.(fieldPath, fieldDefaults);
  };

  return (
    <>
      <div
        ref={ref}
        data-field-path={fieldPath}
        onClick={handleClick}
        style={{
          ...commonStyle, cursor: 'pointer',
          outline: selected ? '2px solid #3B82F6' : undefined, outlineOffset: selected ? 2 : undefined,
        }}
      />
      {selected && (
        <Moveable
          target={ref}
          draggable
          resizable
          rotatable
          origin={false}
          keepRatio={false}
          throttleRotate={1}
          onDrag={({ target, left, top }) => {
            target.style.left = `${left}px`;
            target.style.top = `${top}px`;
          }}
          onDragEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const nx = (parseFloat(target.style.left) || 0) / scale;
            const ny = (parseFloat(target.style.top) || 0) / scale;
            layoutCtx.onCommitFieldOverride?.(fieldPath, { x: nx, y: ny });
          }}
          onResize={({ target, width, height, drag }) => {
            const minW = scale * 0.3;
            const minH = scale * 0.2;
            target.style.width = `${Math.max(minW, width)}px`;
            target.style.height = `${Math.max(minH, height)}px`;
            target.style.left = `${drag.left}px`;
            target.style.top = `${drag.top}px`;
          }}
          onResizeEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const nw = (parseFloat(target.style.width) || 0) / scale;
            const nh = (parseFloat(target.style.height) || 0) / scale;
            const nx = (parseFloat(target.style.left) || 0) / scale;
            const ny = (parseFloat(target.style.top) || 0) / scale;
            layoutCtx.onCommitFieldOverride?.(fieldPath, { x: nx, y: ny, w: nw, h: nh });
          }}
          onRotate={({ target, rotate }) => {
            target.style.transform = `rotate(${rotate}deg)`;
          }}
          onRotateEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const match = /rotate\(([-\d.]+)deg\)/.exec(target.style.transform || '');
            const raw = match ? parseFloat(match[1]) : 0;
            const normalized = Math.round(((raw + 180) % 360 + 360) % 360 - 180);
            layoutCtx.onCommitFieldOverride?.(fieldPath, { rotation: normalized });
          }}
        />
      )}
    </>
  );
}

// Shared select/drag/resize/rotate wrapper for circular template chrome
// (icon-in-circle, numbered badges/dots), mirroring TextBox's
// override-resolution + Moveable pattern but simpler: no edit mode (nothing
// to type into), and resize is ALWAYS aspect-locked (`keepRatio`,
// unconditionally — every handle, not just corners, since a circle
// distorting into an oval on a side-handle drag would look broken, unlike
// free-form text/shapes). `w` is reused as the override key for diameter
// (`d`) — there's no separate height concept for a circle, and reusing `w`
// means PPTX export's shared `resolveBox` doesn't need a circle-specific
// override shape. `children` is called as a render prop function
// (`children(effD)`, not rendered directly) because the inner content's own
// sizing (e.g. the icon glyph's size relative to the circle) depends on the
// RESOLVED diameter, not the caller's original default.
function InteractiveCircle({ x, y, d, scale, fieldPath, layoutCtx, interactive, children }) {
  const ref = useRef(null);
  const override = fieldPath ? layoutCtx?.overrides?.[fieldPath] : null;
  const effX = override?.x ?? x;
  const effY = override?.y ?? y;
  const effD = override?.w ?? d;
  const effRotation = override?.rotation ?? 0;
  const selected = !!(interactive && fieldPath && layoutCtx?.selectedFieldPath === fieldPath);

  const commonStyle = {
    position: 'absolute', left: inch(effX, scale), top: inch(effY, scale),
    width: inch(effD, scale), height: inch(effD, scale),
    transform: effRotation ? `rotate(${effRotation}deg)` : undefined,
    boxSizing: 'border-box', borderRadius: '50%',
  };

  if (!interactive || !fieldPath) {
    return <div style={commonStyle}>{children(effD)}</div>;
  }

  const handleClick = (e) => {
    e.stopPropagation();
    layoutCtx?.onSelectField?.(fieldPath);
  };

  return (
    <>
      <div
        ref={ref}
        data-field-path={fieldPath}
        onClick={handleClick}
        style={{
          ...commonStyle, cursor: 'pointer',
          outline: selected ? '2px solid #3B82F6' : undefined, outlineOffset: selected ? 2 : undefined,
        }}
      >
        {children(effD)}
      </div>
      {selected && (
        <Moveable
          target={ref}
          draggable
          resizable
          rotatable
          origin={false}
          keepRatio
          throttleRotate={1}
          onDrag={({ target, left, top }) => {
            target.style.left = `${left}px`;
            target.style.top = `${top}px`;
          }}
          onDragEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const nx = (parseFloat(target.style.left) || 0) / scale;
            const ny = (parseFloat(target.style.top) || 0) / scale;
            layoutCtx.onCommitFieldOverride?.(fieldPath, { x: nx, y: ny });
          }}
          onResize={({ target, width, height, drag }) => {
            const minD = scale * 0.2;
            const nd = Math.max(minD, Math.max(width, height));
            target.style.width = `${nd}px`;
            target.style.height = `${nd}px`;
            target.style.left = `${drag.left}px`;
            target.style.top = `${drag.top}px`;
          }}
          onResizeEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const nd = (parseFloat(target.style.width) || 0) / scale;
            const nx = (parseFloat(target.style.left) || 0) / scale;
            const ny = (parseFloat(target.style.top) || 0) / scale;
            layoutCtx.onCommitFieldOverride?.(fieldPath, { x: nx, y: ny, w: nd, h: nd });
          }}
          onRotate={({ target, rotate }) => {
            target.style.transform = `rotate(${rotate}deg)`;
          }}
          onRotateEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const match = /rotate\(([-\d.]+)deg\)/.exec(target.style.transform || '');
            const raw = match ? parseFloat(match[1]) : 0;
            const normalized = Math.round(((raw + 180) % 360 + 360) % 360 - 180);
            layoutCtx.onCommitFieldOverride?.(fieldPath, { rotation: normalized });
          }}
        />
      )}
    </>
  );
}

function IconCircle({ iconName, x, y, d, scale, circleColor, iconColor, fieldPath, layoutCtx, interactive }) {
  return (
    <InteractiveCircle x={x} y={y} d={d} scale={scale} fieldPath={fieldPath} layoutCtx={layoutCtx} interactive={interactive}>
      {(effD) => (
        <div
          style={{
            width: '100%', height: '100%', borderRadius: '50%', background: hex(circleColor), boxShadow: CARD_SHADOW_CSS,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <SlideIcon name={iconName || 'lightbulb'} size={inch(effD * 0.44, scale)} color={iconColor} />
        </div>
      )}
    </InteractiveCircle>
  );
}

// Numbered circle badge (AgendaSlide's row numbers, TimelineSlide's dots) —
// same interactive wrapper as IconCircle, just with a number instead of an
// icon glyph inside.
function NumberedCircle({ number, x, y, d, scale, circleColor, textColor, fontSize, fontFamily, fieldPath, layoutCtx, interactive }) {
  return (
    <InteractiveCircle x={x} y={y} d={d} scale={scale} fieldPath={fieldPath} layoutCtx={layoutCtx} interactive={interactive}>
      {() => (
        <div
          style={{
            width: '100%', height: '100%', borderRadius: '50%', background: hex(circleColor), boxShadow: CARD_SHADOW_CSS,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: pt(fontSize, scale), fontFamily, color: hex(textColor), fontWeight: 700,
          }}
        >
          {number}
        </div>
      )}
    </InteractiveCircle>
  );
}

// Character-width heuristic for estimating wrapped line count — mirrors
// src/lib/slides/layouts.js's own estimateLines exactly (same ~0.52em
// average character width assumption), so this preview's bullet push-down
// below reflects roughly the same wrapping the exported .pptx computes, even
// though the two renderers' actual font metrics differ slightly.
function estimateLines(text, boxWidthIn, fontSizePt) {
  if (!text) return 0;
  const avgCharWidthIn = (fontSizePt * 0.52) / 72;
  const charsPerLine = Math.max(1, Math.floor(boxWidthIn / avgCharWidthIn));
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

// Mirrors src/lib/slides/layouts.js's fitFontSize exactly — shrinks
// fontSize (0.5pt steps) until estimateLines' wrapped line count fits the
// given box height, down to a floor of minFontSize.
function fitFontSize(text, boxWidthIn, boxHeightIn, startFontSize, minFontSize = 9) {
  const lineHOf = (fs) => (fs * 1.2) / 72;
  let fontSize = startFontSize;
  while (fontSize > minFontSize) {
    const lines = estimateLines(text, boxWidthIn, fontSize);
    if (lines * lineHOf(fontSize) <= boxHeightIn) break;
    fontSize -= 0.5;
  }
  return fontSize;
}

// Mirrors src/lib/slides/layouts.js's bulletBlockHeight — estimates a
// bullet list's natural height as the sum of each bullet's own
// estimateLines()-based height (NO floor — must match BulletList's cursor
// step below exactly, not its separate box-height floor) so a short list can
// be vertically centered within a taller available area instead of pinned to
// the top with empty space below it. An earlier version floored each
// bullet's height at 2 lines here, which inflated the estimate for ordinary
// short (1-line) bullets and, via the centering math below, pushed the whole
// block down with a large empty gap above it.
function bulletBlockHeight(bullets, fontSize, boxWidthIn) {
  const lineH = (fontSize * 1.2) / 72;
  const gapH = 10 / 72;
  return (
    bullets.reduce((sum, b) => sum + estimateLines(b, boxWidthIn, fontSize) * lineH, 0) +
    Math.max(0, bullets.length - 1) * gapH
  );
}

// `editable`/`onCommitBullet(index, text)` (optional) enables click-to-edit,
// same as TextBox.
//
// Each bullet is its own independently-draggable TextBox (fieldPath
// `${basePath}[i]`) instead of one flowed <ul><li> list — default position
// steps down the list the same way the old flowed version did (mirrors
// bulletBlockHeight's per-item lineH+gap math above, computed explicitly
// here instead of implicitly via CSS block flow). The "•" marker is a
// native CSS list-item marker (TextBox's `listMarker` prop), not a separate
// sibling element — a separate marker would visually detach from its
// bullet's text the moment that bullet is dragged to a new position. The
// cursor steps down by THIS bullet's own estimateLines()-based line count
// (no floor) — a bullet needing 3+ lines now pushes every LATER bullet down
// by its own estimated height instead of clipping in place or overlapping
// the next one, restoring the old flowed <ul> layout's push-down behavior
// while keeping each bullet individually positionable (an explicit
// layoutOverrides position for a given bullet still wins over this computed
// default, same as every other field). The box's OWN height is separately
// floored at 2 lines purely as a comfortable click/edit target — that floor
// must NOT feed the cursor step too (an earlier version conflated the two,
// which inflated the gap after every ordinary short bullet).
function BulletList({ bullets, x, y, w, scale, color, fontFamily, fontSize, editable, onCommitBullet, fieldPath: basePath = 'bullets', layoutCtx }) {
  const lineH = (fontSize * 1.2) / 72;
  const gapH = 10 / 72;
  let cursorY = y;
  return bullets.map((b, i) => {
    const lines = estimateLines(b, w, fontSize);
    const boxH = Math.max(2, lines) * lineH;
    const itemY = cursorY;
    cursorY += lines * lineH + gapH;
    return (
      <TextBox
        key={i}
        x={x} y={itemY} w={w} h={boxH} scale={scale}
        fontSize={fontSize} fontFamily={fontFamily} color={color} style={{ lineHeight: 1.3 }}
        editable={editable} onCommit={(t) => onCommitBullet?.(i, t)}
        fieldPath={`${basePath}[${i}]`} layoutCtx={layoutCtx}
        listMarker
      >
        {b}
      </TextBox>
    );
  });
}

// Mirrors src/lib/slides/layouts.js's addChecklistRows exactly — "bold"/
// "warm" reserve a real inter-row gap and draw a per-row card; "plain" keeps
// the original zero-gap packing.
function ChecklistRows({ items, x, y, w, h, scale, theme, textColor, checkColor, interactive, onCommitField, basePath = 'items', layoutCtx, style = PLAIN_STYLE }) {
  const useCard = CARD_DRAWING_SHAPES.has(style.shape);
  const spaceScale = style.spaceScale ?? 1;
  const iconScale = style.iconScale ?? 1;
  const gap = useCard ? 0.12 * spaceScale : 0;
  const rowH = Math.min(1.15 * spaceScale, (h - gap * (items.length - 1)) / items.length);
  const iconD = 0.3 * iconScale;
  const pad = useCard ? 0.12 : 0;
  const startY = y + Math.max(0, (h - (rowH * items.length + gap * (items.length - 1))) / 2);
  return items.map((item, i) => {
    const rowY = startY + i * (rowH + gap);
    const innerX = x + pad;
    const innerY = rowY + pad;
    const innerW = w - 2 * pad;
    const chrome = cardChromeFor(theme, style);
    return (
      <div key={i}>
        {useCard && (
          <Shape
            x={x} y={rowY} w={w} h={rowH} scale={scale}
            fill={chrome.background} border={chrome.border} radius={CARD_RADIUS} shadow={style.shape !== 'outline'}
            fieldPath={`${basePath}[${i}].card`} layoutCtx={layoutCtx} interactive={interactive}
          />
        )}
        <div style={{ position: 'absolute', left: inch(innerX, scale), top: inch(innerY + 0.05, scale), width: inch(iconD, scale), height: inch(iconD, scale) }}>
          <SlideIcon name="check" size={inch(iconD, scale)} color={checkColor} />
        </div>
        <TextBox
          x={innerX + iconD + 0.25} y={innerY} w={innerW - iconD - 0.25} h={0.35} scale={scale} fontSize={TYPE_SCALE.body + (style.boldLabel ? 2 : 0)} fontFamily={theme.fonts.body} color={textColor} bold
          editable={interactive} onCommit={(t) => onCommitField?.(`${basePath}[${i}].label`, t)}
          fieldPath={`${basePath}[${i}].label`} layoutCtx={layoutCtx}
        >
          {item.label}
        </TextBox>
        {item.description && (
          <TextBox
            x={innerX + iconD + 0.25} y={innerY + 0.35} w={innerW - iconD - 0.25} h={Math.max(0, rowH - 2 * pad - 0.4)} scale={scale} fontSize={TYPE_SCALE.caption + 1} fontFamily={theme.fonts.body} color={MUTED}
            editable={interactive} onCommit={(t) => onCommitField?.(`${basePath}[${i}].description`, t)}
            fieldPath={`${basePath}[${i}].description`} layoutCtx={layoutCtx}
          >
            {item.description}
          </TextBox>
        )}
      </div>
    );
  });
}

// style.heroScale (default 1) resizes both circles — mirrors
// src/lib/slides/layouts.js's addDecorativeCircles exactly, including the
// top-right circle's pinned-bottom-edge invariant (R1_BOTTOM is a FIXED
// offset, not a multiple of r1): a naive proportional offset was verified
// there to push the enlarged circle's bottom edge into title text at
// heroScale 1.15/1.25, so this keeps that same fixed anchor rather than
// re-deriving its own formula.
function DecorativeCircles({ theme, scale, style = PLAIN_STYLE }) {
  const heroScale = style.heroScale ?? 1;
  const R1_BOTTOM = 4.6 * 0.45;
  const r1 = 4.6 * heroScale;
  const secondaryColor = style.shape === 'warm' ? mixHex(theme.palette.secondary, theme.palette.primary, 0.3) : theme.palette.secondary;
  const r2 = 3.0 * heroScale;
  const accentColor = style.shape === 'warm' ? mixHex(theme.palette.accent, theme.palette.primary, 0.3) : theme.palette.accent;
  return (
    <>
      <div style={{
        position: 'absolute', left: inch(SLIDE_W - r1 * 0.62, scale), top: inch(R1_BOTTOM - r1, scale),
        width: inch(r1, scale), height: inch(r1, scale), borderRadius: '50%',
        background: hex(secondaryColor), opacity: 0.28,
      }} />
      <div style={{
        position: 'absolute', left: inch(-r2 * 0.55, scale), top: inch(SLIDE_H - r2 * 0.5, scale),
        width: inch(r2, scale), height: inch(r2, scale), borderRadius: '50%',
        background: hex(accentColor), opacity: 0.20,
      }} />
    </>
  );
}

// slide.heroImage — an AI-generated accent image for title/section_header/
// closing/quote slides. Rendered here, BEFORE each slide's own <TextBox>es
// in JSX/DOM order (plain elements paint in DOM order with no z-index set),
// so it always sits visually behind the text — mirrors
// src/lib/slides/layouts.js's drawHeroImage, which likewise draws before
// its slide's own addText calls. Deliberately separate from FreeformLayer
// (which renders slide.elements — the user's own manual overlay, always on
// top): a hero image needs the opposite stacking position, so it's its own
// dedicated field, not an elements[] entry.
//
// Position/size/rotation ARE overridable via layoutOverrides["heroImage"],
// through the exact same fieldPath/layoutCtx/Moveable pattern as Shape
// below — free resize (not aspect-locked), since unlike a freeform image
// element this field carries no stored pixel width/height to lock to, and
// objectFit: 'cover' already crops gracefully to any box.
function HeroImage({ slide, scale, interactive, layoutCtx }) {
  const ref = useRef(null);
  if (!slide.heroImage?.src) return null;
  const fieldPath = 'heroImage';
  const override = layoutCtx?.overrides?.[fieldPath];
  const effX = override?.x ?? (SLIDE_W - HERO_IMAGE_PANEL_W);
  const effY = override?.y ?? 0;
  const effW = override?.w ?? HERO_IMAGE_PANEL_W;
  const effH = override?.h ?? SLIDE_H;
  const effRotation = override?.rotation ?? 0;
  const selected = !!(interactive && layoutCtx?.selectedFieldPath === fieldPath);

  const commonStyle = {
    position: 'absolute', left: inch(effX, scale), top: inch(effY, scale), width: inch(effW, scale), height: inch(effH, scale),
    transform: effRotation ? `rotate(${effRotation}deg)` : undefined,
    objectFit: 'cover', boxSizing: 'border-box',
  };

  if (!interactive) {
    return <img src={slide.heroImage.src} alt="" style={commonStyle} />;
  }

  const handleClick = (e) => {
    e.stopPropagation();
    layoutCtx?.onSelectField?.(fieldPath, { kind: 'image' });
  };

  return (
    <>
      <img
        ref={ref}
        src={slide.heroImage.src}
        alt=""
        draggable={false}
        onClick={handleClick}
        style={{
          ...commonStyle, cursor: 'pointer',
          outline: selected ? '2px solid #3B82F6' : undefined, outlineOffset: selected ? 2 : undefined,
        }}
      />
      {selected && (
        <Moveable
          target={ref}
          draggable
          resizable
          rotatable
          origin={false}
          keepRatio={false}
          throttleRotate={1}
          onDrag={({ target, left, top }) => {
            target.style.left = `${left}px`;
            target.style.top = `${top}px`;
          }}
          onDragEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const nx = (parseFloat(target.style.left) || 0) / scale;
            const ny = (parseFloat(target.style.top) || 0) / scale;
            layoutCtx.onCommitFieldOverride?.(fieldPath, { x: nx, y: ny });
          }}
          onResize={({ target, width, height, drag }) => {
            const minW = scale * 0.3;
            const minH = scale * 0.2;
            target.style.width = `${Math.max(minW, width)}px`;
            target.style.height = `${Math.max(minH, height)}px`;
            target.style.left = `${drag.left}px`;
            target.style.top = `${drag.top}px`;
          }}
          onResizeEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const nw = (parseFloat(target.style.width) || 0) / scale;
            const nh = (parseFloat(target.style.height) || 0) / scale;
            const nx = (parseFloat(target.style.left) || 0) / scale;
            const ny = (parseFloat(target.style.top) || 0) / scale;
            layoutCtx.onCommitFieldOverride?.(fieldPath, { x: nx, y: ny, w: nw, h: nh });
          }}
          onRotate={({ target, rotate }) => {
            target.style.transform = `rotate(${rotate}deg)`;
          }}
          onRotateEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const match = /rotate\(([-\d.]+)deg\)/.exec(target.style.transform || '');
            const raw = match ? parseFloat(match[1]) : 0;
            const normalized = Math.round(((raw + 180) % 360 + 360) % 360 - 180);
            layoutCtx.onCommitFieldOverride?.(fieldPath, { rotation: normalized });
          }}
        />
      )}
    </>
  );
}

// Mirrors src/lib/slides/layouts.js's addHeroKicker exactly — a small
// accent bar above a hero slide's title, shown only when getStyle()'s
// heroFontDelta is positive (the existing "how energetic is this
// presentationType" signal, reused rather than adding a second per-type
// config map for one boolean).
function HeroKicker({ theme, scale, style, x, y }) {
  if (!((style.heroFontDelta ?? 0) > 0)) return null;
  return (
    <div style={{
      position: 'absolute', left: inch(x, scale), top: inch(y - 0.3, scale),
      width: inch(0.55, scale), height: inch(0.08, scale),
      background: hex(theme.palette.accent),
    }} />
  );
}

function TitleSlide({ slide, theme, scale, color, interactive, onCommitField, layoutCtx, style = PLAIN_STYLE }) {
  const hasHeroImage = !!slide.heroImage?.src;
  const textW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  return (
    <>
      <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />
      <HeroKicker theme={theme} scale={scale} style={style} x={CONTENT_X} y={2.7} />
      <TextBox
        x={CONTENT_X} y={2.7} w={textW} h={1.6} scale={scale} fontSize={TYPE_SCALE.title + (style.heroFontDelta ?? 0)} fontFamily={theme.fonts.header} color={color} bold valign="middle"
        editable={interactive} onCommit={(t) => onCommitField?.('title', t)}
        fieldPath="title" layoutCtx={layoutCtx}
      >
        {slide.title}
      </TextBox>
      {slide.subtitle && (
        <TextBox
          x={CONTENT_X} y={4.3} w={textW} h={0.7} scale={scale} fontSize={TYPE_SCALE.body + 4} fontFamily={theme.fonts.body} color={color} italic
          editable={interactive} onCommit={(t) => onCommitField?.('subtitle', t)}
          fieldPath="subtitle" layoutCtx={layoutCtx}
        >
          {slide.subtitle}
        </TextBox>
      )}
    </>
  );
}

function SectionHeaderSlide({ slide, theme, scale, color, interactive, onCommitField, layoutCtx, style = PLAIN_STYLE }) {
  const hasHeroImage = !!slide.heroImage?.src;
  const textW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  return (
    <>
      <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />
      <TextBox
        x={CONTENT_X} y={2.7} w={textW} h={1.3} scale={scale} fontSize={TYPE_SCALE.sectionTitle + (style.heroFontDelta ?? 0)} fontFamily={theme.fonts.header} color={color} bold valign="middle"
        editable={interactive} onCommit={(t) => onCommitField?.('title', t)}
        fieldPath="title" layoutCtx={layoutCtx}
      >
        {slide.title}
      </TextBox>
      <TextBox
        x={CONTENT_X} y={4.0} w={hasHeroImage ? textW : CONTENT_W - 2} h={0.9} scale={scale} fontSize={TYPE_SCALE.body + 3} fontFamily={theme.fonts.body} color={color}
        editable={interactive} onCommit={(t) => onCommitField?.('subtitle', t)}
        fieldPath="subtitle" layoutCtx={layoutCtx}
      >
        {slide.subtitle}
      </TextBox>
    </>
  );
}

function ClosingSlide({ slide, theme, scale, color, interactive, onCommitField, layoutCtx, style = PLAIN_STYLE }) {
  const hasHeroImage = !!slide.heroImage?.src;
  const textW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  return (
    <>
      <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />
      <HeroKicker theme={theme} scale={scale} style={style} x={CONTENT_X} y={2.1} />
      <TextBox
        x={CONTENT_X} y={2.1} w={textW} h={1.1} scale={scale} fontSize={TYPE_SCALE.sectionTitle + (style.heroFontDelta ?? 0)} fontFamily={theme.fonts.header} color={color} bold valign="middle"
        editable={interactive} onCommit={(t) => onCommitField?.('title', t)}
        fieldPath="title" layoutCtx={layoutCtx}
      >
        {slide.title}
      </TextBox>
      {slide.subtitle && (
        <TextBox
          x={CONTENT_X} y={3.2} w={hasHeroImage ? textW : CONTENT_W - 2} h={1.0} scale={scale} fontSize={TYPE_SCALE.body + 3} fontFamily={theme.fonts.body} color={color}
          editable={interactive} onCommit={(t) => onCommitField?.('subtitle', t)}
          fieldPath="subtitle" layoutCtx={layoutCtx}
        >
          {slide.subtitle}
        </TextBox>
      )}
      {slide.bullets && slide.bullets.length > 0 && (
        // Rendered as one joined caption line, not individually editable —
        // not worth a separate per-bullet edit affordance for this rarely
        // used credits/contact line.
        <TextBox x={CONTENT_X} y={SLIDE_H - MARGIN - 0.5} w={textW} h={0.4} scale={scale} fontSize={TYPE_SCALE.caption + 1} fontFamily={theme.fonts.body} color={color}>
          {slide.bullets.join('   |   ')}
        </TextBox>
      )}
    </>
  );
}

// Every non-title-type layout's own title always maps to the slide's
// top-level "title" field — hardcoded here so call sites don't need to pass
// a redundant fieldPath.
function TitleText({ theme, scale, color, text, interactive, onCommitField, layoutCtx, w = CONTENT_W }) {
  return (
    <TextBox
      x={CONTENT_X} y={TITLE_Y} w={w} h={TITLE_H} scale={scale} fontSize={TYPE_SCALE.slideTitle} fontFamily={theme.fonts.header} color={color} bold
      editable={interactive} onCommit={(t) => onCommitField?.('title', t)}
      fieldPath="title" layoutCtx={layoutCtx}
    >
      {text}
    </TextBox>
  );
}

function AgendaSlide({ slide, theme, scale, color, interactive, onCommitField, layoutCtx }) {
  const items = slide.bullets;
  const rowH = Math.min(0.9, BODY_H / items.length);
  const gap = 0.15;
  const d = rowH - gap;
  const hasHeroImage = !!slide.heroImage?.src;
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  return (
    <>
      <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />
      <TitleText theme={theme} scale={scale} color={color} text={slide.title} interactive={interactive} onCommitField={onCommitField} layoutCtx={layoutCtx} w={contentW} />
      {items.map((item, i) => {
        const y = BODY_Y + i * rowH;
        const circleColor = rotatingColor(theme, i);
        return (
          <div key={i}>
            <NumberedCircle
              number={i + 1} x={CONTENT_X} y={y} d={d} scale={scale}
              circleColor={circleColor} textColor={contrastText(circleColor)}
              fontSize={TYPE_SCALE.body + 2} fontFamily={theme.fonts.body}
              fieldPath={`bullets[${i}].badge`} layoutCtx={layoutCtx} interactive={interactive}
            />
            <TextBox
              x={CONTENT_X + d + 0.3} y={y} w={contentW - d - 0.3} h={d} scale={scale} fontSize={TYPE_SCALE.body + 2} fontFamily={theme.fonts.body} color={color} valign="middle"
              editable={interactive} onCommit={(t) => onCommitField?.(`bullets[${i}]`, t)}
              fieldPath={`bullets[${i}]`} layoutCtx={layoutCtx}
            >
              {item}
            </TextBox>
          </div>
        );
      })}
    </>
  );
}

function BulletsSlide({ slide, theme, scale, color, slideIndex, interactive, onCommitField, layoutCtx }) {
  const bulletsW = 7.6;
  const bulletFontSize = TYPE_SCALE.body + 1;
  const bulletsH = Math.min(BODY_H, bulletBlockHeight(slide.bullets, bulletFontSize, bulletsW));
  const bulletsY = BODY_Y + Math.min(MAX_BULLETS_TOP_GAP, Math.max(0, (BODY_H - bulletsH) / 2));
  const d = 2.8;
  const circleColor = rotatingColor(theme, slideIndex);
  // Mirrors src/lib/slides/layouts.js's buildBulletsSlide exactly — the icon
  // circle already floats in roughly HERO_IMAGE_PANEL_W's zone, so an image
  // replaces it rather than the bullets themselves narrowing.
  const hasHeroImage = !!slide.heroImage?.src;
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  return (
    <>
      <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />
      <TitleText theme={theme} scale={scale} color={color} text={slide.title} interactive={interactive} onCommitField={onCommitField} layoutCtx={layoutCtx} w={contentW} />
      <BulletList
        bullets={slide.bullets} x={CONTENT_X} y={bulletsY} w={bulletsW} scale={scale} color={color} fontFamily={theme.fonts.body} fontSize={bulletFontSize}
        editable={interactive} onCommitBullet={(i, t) => onCommitField?.(`bullets[${i}]`, t)} layoutCtx={layoutCtx}
      />
      {!hasHeroImage && (
        <IconCircle iconName={slide.icon || 'lightbulb'} x={CONTENT_X + bulletsW + 0.6} y={bulletsY + (bulletsH - d) / 2} d={d} scale={scale} circleColor={circleColor} iconColor={contrastText(circleColor)} fieldPath="icon" layoutCtx={layoutCtx} interactive={interactive} />
      )}
    </>
  );
}

function TwoColumnSlide({ slide, theme, scale, color, slideIndex, interactive, onCommitField, layoutCtx }) {
  const leftW = 6.8;
  const bulletFontSize = TYPE_SCALE.body + 1;
  const bulletsH = Math.min(BODY_H, bulletBlockHeight(slide.bullets, bulletFontSize, leftW));
  const bulletsY = BODY_Y + Math.min(MAX_BULLETS_TOP_GAP, Math.max(0, (BODY_H - bulletsH) / 2));
  const cardX = CONTENT_X + leftW + 0.5;
  const cardW = CONTENT_W - leftW - 0.5;
  const cardColor = rotatingColor(theme, slideIndex);
  const d = 2.2;
  const circleColor = rotatingColor(theme, slideIndex + 1);
  // Mirrors src/lib/slides/layouts.js's buildTwoColumnSlide exactly — the
  // card+icon already sits almost exactly in HERO_IMAGE_PANEL_W's zone, so
  // an image replaces it.
  const hasHeroImage = !!slide.heroImage?.src;
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  return (
    <>
      <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />
      <TitleText theme={theme} scale={scale} color={color} text={slide.title} interactive={interactive} onCommitField={onCommitField} layoutCtx={layoutCtx} w={contentW} />
      <BulletList
        bullets={slide.bullets} x={CONTENT_X} y={bulletsY} w={leftW} scale={scale} color={color} fontFamily={theme.fonts.body} fontSize={bulletFontSize}
        editable={interactive} onCommitBullet={(i, t) => onCommitField?.(`bullets[${i}]`, t)} layoutCtx={layoutCtx}
      />
      {!hasHeroImage && (
        <>
          <Shape x={cardX} y={BODY_Y} w={cardW} h={BODY_H} scale={scale} fill={hex(cardColor)} radius={CARD_RADIUS} shadow fieldPath="card" layoutCtx={layoutCtx} interactive={interactive} />
          <IconCircle iconName={slide.icon || 'lightbulb'} x={cardX + (cardW - d) / 2} y={BODY_Y + (BODY_H - d) / 2 - 0.2} d={d} scale={scale} circleColor={circleColor} iconColor={contrastText(circleColor)} fieldPath="icon" layoutCtx={layoutCtx} interactive={interactive} />
        </>
      )}
    </>
  );
}

function IconGridSlide({ slide, theme, scale, color, interactive, onCommitField, layoutCtx, style = PLAIN_STYLE }) {
  const items = slide.items;
  // Mirrors src/lib/slides/layouts.js's buildIconGridSlide exactly —
  // "bold"/"warm"/"outline" get a per-item card.
  const useCard = CARD_DRAWING_SHAPES.has(style.shape);
  const spaceScale = style.spaceScale ?? 1;
  const iconScale = style.iconScale ?? 1;

  const hasHeroImage = !!slide.heroImage?.src;
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;

  const cols = items.length <= 3 ? items.length : 3;
  const rows = Math.ceil(items.length / cols);
  const gap = 0.35 * spaceScale;
  const cellW = (contentW - gap * (cols - 1)) / cols;
  const maxCellH = 2.6 * spaceScale;
  const cellH = Math.min(maxCellH, (BODY_H - gap * (rows - 1)) / rows);
  const gridH = rows * cellH + gap * (rows - 1);
  const gridY = BODY_Y + Math.max(0, (BODY_H - gridH) / 2);

  const pad = useCard ? 0.15 : 0;
  const d = (useCard ? 0.6 : 0.75) * iconScale;
  const labelGap = useCard ? 0.1 : 0.15;
  const labelH = (useCard ? 0.55 : 0.62) * iconScale;
  const labelFontSize = TYPE_SCALE.body + 1 + (style.boldLabel ? 2 : 0);
  const chrome = cardChromeFor(theme, style);

  return (
    <>
      <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />
      <TitleText theme={theme} scale={scale} color={color} text={slide.title} interactive={interactive} onCommitField={onCommitField} layoutCtx={layoutCtx} w={contentW} />
      {items.map((item, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cellX = CONTENT_X + col * (cellW + gap);
        const cellY = gridY + row * (cellH + gap);
        const circleColor = style.uniformColor ? ensureReadableOnLight(theme.palette.primary) : rotatingColor(theme, i);
        const innerX = cellX + pad;
        const innerY = cellY + pad;
        const innerW = cellW - 2 * pad;
        const innerBottom = cellY + cellH - pad;
        const descY = innerY + d + labelGap + labelH;
        return (
          <div key={i}>
            {useCard && (
              <Shape
                x={cellX} y={cellY} w={cellW} h={cellH} scale={scale}
                fill={chrome.background} border={chrome.border} radius={CARD_RADIUS} shadow={style.shape !== 'outline'}
                fieldPath={`items[${i}].card`} layoutCtx={layoutCtx} interactive={interactive}
              />
            )}
            <IconCircle iconName={item.icon} x={innerX} y={innerY} d={d} scale={scale} circleColor={circleColor} iconColor={contrastText(circleColor)} fieldPath={`items[${i}].icon`} layoutCtx={layoutCtx} interactive={interactive} />
            <TextBox
              x={innerX} y={innerY + d + labelGap} w={innerW} h={labelH} scale={scale} fontSize={labelFontSize} fontFamily={theme.fonts.body} color={color} bold
              editable={interactive} onCommit={(t) => onCommitField?.(`items[${i}].label`, t)}
              fieldPath={`items[${i}].label`} layoutCtx={layoutCtx}
            >
              {item.label}
            </TextBox>
            {item.description && (
              <TextBox
                x={innerX} y={descY} w={innerW} h={Math.max(0, innerBottom - descY)} scale={scale} fontSize={TYPE_SCALE.caption + 1} fontFamily={theme.fonts.body} color={MUTED}
                editable={interactive} onCommit={(t) => onCommitField?.(`items[${i}].description`, t)}
                fieldPath={`items[${i}].description`} layoutCtx={layoutCtx}
              >
                {item.description}
              </TextBox>
            )}
          </div>
        );
      })}
    </>
  );
}

function IconListSlide({ slide, theme, scale, color, interactive, onCommitField, layoutCtx, style = PLAIN_STYLE }) {
  const items = slide.items;
  // Mirrors src/lib/slides/layouts.js's buildIconListSlide exactly.
  const useCard = CARD_DRAWING_SHAPES.has(style.shape);
  const spaceScale = style.spaceScale ?? 1;
  const iconScale = style.iconScale ?? 1;

  const gap = useCard ? 0.15 * spaceScale : 0;
  const rowH = Math.min(1.35 * spaceScale, (BODY_H - gap * (items.length - 1)) / items.length);
  const d = 0.55 * iconScale;
  const pad = useCard ? 0.15 : 0;
  const startY = BODY_Y + Math.max(0, (BODY_H - (rowH * items.length + gap * (items.length - 1))) / 2);
  const hasHeroImage = !!slide.heroImage?.src;
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  const chrome = cardChromeFor(theme, style);

  return (
    <>
      <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />
      <TitleText theme={theme} scale={scale} color={color} text={slide.title} interactive={interactive} onCommitField={onCommitField} layoutCtx={layoutCtx} w={contentW} />
      {items.map((item, i) => {
        const y = startY + i * (rowH + gap);
        const innerX = CONTENT_X + pad;
        const innerY = y + pad;
        const innerW = contentW - 2 * pad;
        const innerH = rowH - 2 * pad;
        const circleColor = style.uniformColor ? ensureReadableOnLight(theme.palette.primary) : rotatingColor(theme, i);
        return (
          <div key={i}>
            {useCard && (
              <Shape
                x={CONTENT_X} y={y} w={contentW} h={rowH} scale={scale}
                fill={chrome.background} border={chrome.border} radius={CARD_RADIUS} shadow={style.shape !== 'outline'}
                fieldPath={`items[${i}].card`} layoutCtx={layoutCtx} interactive={interactive}
              />
            )}
            <IconCircle iconName={item.icon} x={innerX} y={innerY + (innerH - d) / 2 - (useCard ? 0 : 0.15)} d={d} scale={scale} circleColor={circleColor} iconColor={contrastText(circleColor)} fieldPath={`items[${i}].icon`} layoutCtx={layoutCtx} interactive={interactive} />
            <TextBox
              x={innerX + d + 0.35} y={innerY} w={innerW - d - 0.35} h={0.4} scale={scale} fontSize={TYPE_SCALE.body + 2 + (style.boldLabel ? 2 : 0)} fontFamily={theme.fonts.body} color={color} bold
              editable={interactive} onCommit={(t) => onCommitField?.(`items[${i}].label`, t)}
              fieldPath={`items[${i}].label`} layoutCtx={layoutCtx}
            >
              {item.label}
            </TextBox>
            {item.description && (
              <TextBox
                x={innerX + d + 0.35} y={innerY + 0.4} w={innerW - d - 0.35} h={Math.max(0, innerH - 0.45)} scale={scale} fontSize={TYPE_SCALE.body - 1} fontFamily={theme.fonts.body} color={MUTED}
                editable={interactive} onCommit={(t) => onCommitField?.(`items[${i}].description`, t)}
                fieldPath={`items[${i}].description`} layoutCtx={layoutCtx}
              >
                {item.description}
              </TextBox>
            )}
          </div>
        );
      })}
    </>
  );
}

function FeatureSplitSlide({ slide, theme, scale, color, slideIndex, interactive, onCommitField, layoutCtx, style = PLAIN_STYLE }) {
  const panelW = 3.9;
  const panelColor = rotatingColor(theme, slideIndex);
  const panelTextColor = contrastText(panelColor);
  const d = 1.5 * (style.iconScale ?? 1);
  const circleColor = rotatingColor(theme, slideIndex + 1);
  const hasHeroImage = !!slide.heroImage?.src;
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  const listX = CONTENT_X + panelW + 0.6;
  const listW = contentW - panelW - 0.6;
  return (
    <>
      <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />
      <TitleText theme={theme} scale={scale} color={color} text={slide.title} interactive={interactive} onCommitField={onCommitField} layoutCtx={layoutCtx} w={contentW} />
      <Shape x={CONTENT_X} y={BODY_Y} w={panelW} h={BODY_H} scale={scale} fill={hex(panelColor)} radius={CARD_RADIUS} shadow fieldPath="panel" layoutCtx={layoutCtx} interactive={interactive} />
      <IconCircle iconName={slide.icon || 'shield'} x={CONTENT_X + (panelW - d) / 2} y={BODY_Y + 0.6} d={d} scale={scale} circleColor={circleColor} iconColor={contrastText(circleColor)} fieldPath="icon" layoutCtx={layoutCtx} interactive={interactive} />
      <TextBox
        x={CONTENT_X + 0.3} y={BODY_Y + 0.6 + d + 0.3} w={panelW - 0.6} h={1.3} scale={scale} fontSize={TYPE_SCALE.body + 4 + (style.boldLabel ? 2 : 0)} fontFamily={theme.fonts.header} color={panelTextColor} bold align="center"
        editable={interactive} onCommit={(t) => onCommitField?.('panelLabel', t)}
        fieldPath="panelLabel" layoutCtx={layoutCtx}
      >
        {slide.panelLabel}
      </TextBox>
      <ChecklistRows
        items={slide.items} x={listX} y={BODY_Y} w={listW} h={BODY_H} scale={scale} theme={theme} textColor={color} checkColor={ensureReadableOnLight(theme.palette.primary)}
        interactive={interactive} onCommitField={onCommitField} layoutCtx={layoutCtx} style={style}
      />
    </>
  );
}

// Mirrors src/lib/slides/layouts.js's buildStatCalloutSlide exactly — three
// structurally different renderings by style.shape, not just a scale/color
// tweak on one shared layout (see that file's own comment on why "bold"'s
// divider and "warm"'s badge each need bespoke geometry).
function StatCalloutSlide({ slide, theme, scale, color, interactive, onCommitField, layoutCtx, style = PLAIN_STYLE }) {
  const contextH = 0.6;
  const statsY = TITLE_Y + TITLE_H + contextH + 0.15;
  const statsH = SLIDE_H - MARGIN - statsY;
  const stats = slide.stats;
  const numScale = style.iconScale ?? 1;
  const spaceScale = style.spaceScale ?? 1;
  const numberColorFor = (i) => (style.uniformColor ? ensureReadableOnLight(theme.palette.primary) : rotatingColor(theme, i));
  const numberFontSize = TYPE_SCALE.statNumber * numScale;
  const hasHeroImage = !!slide.heroImage?.src;
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  const gap = 0.4 * spaceScale;
  const cardW = (contentW - gap * (stats.length - 1)) / stats.length;
  const cardH = Math.min(3.2, statsH);
  const y = statsY + Math.max(0, (statsH - cardH) / 2);

  const heroImageField = <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />;
  const contextField = (
    <TextBox
      x={CONTENT_X} y={TITLE_Y + TITLE_H} w={contentW} h={contextH} scale={scale} fontSize={TYPE_SCALE.body + 1} fontFamily={theme.fonts.body} color={MUTED}
      editable={interactive} onCommit={(t) => onCommitField?.('context', t)}
      fieldPath="context" layoutCtx={layoutCtx}
    >
      {slide.context}
    </TextBox>
  );
  const titleField = <TitleText theme={theme} scale={scale} color={color} text={slide.title} interactive={interactive} onCommitField={onCommitField} layoutCtx={layoutCtx} w={contentW} />;

  if (style.shape === 'bold') {
    const numberH = 1.5;
    const dividerGap = 0.15;
    const dividerH = 0.05;
    const labelGap = 0.15;
    return (
      <>
        {heroImageField}
        {titleField}
        {contextField}
        {stats.map((stat, i) => {
          const x = CONTENT_X + i * (cardW + gap);
          const numberColor = numberColorFor(i);
          const dividerW = Math.min(1.3, cardW * 0.5);
          // Shrink to the longest value actually needs — a fixed 64pt
          // number vs. a value like "$482.3M" in a narrow (3-4 stat) card
          // otherwise clips left/right, same fix as layouts.js's export path.
          const valueFontSize = fitFontSize(stat.value, cardW * 0.9, numberH, numberFontSize, 24);
          return (
            <div key={i}>
              <TextBox
                x={x} y={y} w={cardW} h={numberH} scale={scale} fontSize={valueFontSize} fontFamily={theme.fonts.header} color={numberColor} bold align="center" valign="middle"
                editable={interactive} onCommit={(t) => onCommitField?.(`stats[${i}].value`, t)}
                fieldPath={`stats[${i}].value`} layoutCtx={layoutCtx}
              >
                {stat.value}
              </TextBox>
              <div style={{
                position: 'absolute', left: inch(x + (cardW - dividerW) / 2, scale), top: inch(y + numberH + dividerGap, scale),
                width: inch(dividerW, scale), height: inch(dividerH, scale), background: hex(numberColor),
              }} />
              <TextBox
                x={x + 0.15} y={y + numberH + dividerGap + dividerH + labelGap} w={cardW - 0.3} h={cardH - numberH - dividerGap - dividerH - labelGap} scale={scale} fontSize={TYPE_SCALE.body} fontFamily={theme.fonts.body} color={MUTED} align="center"
                editable={interactive} onCommit={(t) => onCommitField?.(`stats[${i}].label`, t)}
                fieldPath={`stats[${i}].label`} layoutCtx={layoutCtx}
              >
                {stat.label}
              </TextBox>
            </div>
          );
        })}
      </>
    );
  }

  if (style.shape === 'warm') {
    const badgeD = Math.min(2.0, cardW * 0.55);
    return (
      <>
        {heroImageField}
        {titleField}
        {contextField}
        {stats.map((stat, i) => {
          const x = CONTENT_X + i * (cardW + gap);
          const numberColor = numberColorFor(i);
          const labelY = y + 0.25 + badgeD + 0.15;
          const valueFontSize = fitFontSize(stat.value, cardW * 0.9, badgeD, numberFontSize, 24);
          return (
            <div key={i}>
              <div style={{
                position: 'absolute', left: inch(x, scale), top: inch(y, scale), width: inch(cardW, scale), height: inch(cardH, scale),
                background: hex(warmFillColor(theme)), border: `1px solid ${hex(CARD_BORDER)}`, borderRadius: inch(CARD_RADIUS, scale), boxShadow: CARD_SHADOW_CSS, boxSizing: 'border-box',
              }} />
              <div style={{
                position: 'absolute', left: inch(x + (cardW - badgeD) / 2, scale), top: inch(y + 0.25, scale), width: inch(badgeD, scale), height: inch(badgeD, scale), borderRadius: '50%',
                background: hex(mixHex(theme.palette.primary, 'FFFFFF', 0.65)),
              }} />
              <TextBox
                x={x} y={y + 0.25} w={cardW} h={badgeD} scale={scale} fontSize={valueFontSize} fontFamily={theme.fonts.header} color={numberColor} bold align="center" valign="middle"
                editable={interactive} onCommit={(t) => onCommitField?.(`stats[${i}].value`, t)}
                fieldPath={`stats[${i}].value`} layoutCtx={layoutCtx}
              >
                {stat.value}
              </TextBox>
              <TextBox
                x={x + 0.3} y={labelY} w={cardW - 0.6} h={Math.max(0, y + cardH - 0.15 - labelY)} scale={scale} fontSize={TYPE_SCALE.body} fontFamily={theme.fonts.body} color={MUTED} align="center"
                editable={interactive} onCommit={(t) => onCommitField?.(`stats[${i}].label`, t)}
                fieldPath={`stats[${i}].label`} layoutCtx={layoutCtx}
              >
                {stat.label}
              </TextBox>
            </div>
          );
        })}
      </>
    );
  }

  // "plain" shape — byte-identical to before this feature existed when
  // numScale/spaceScale/uniformColor are all at their defaults.
  return (
    <>
      {heroImageField}
      {titleField}
      {contextField}
      {stats.map((stat, i) => {
        const x = CONTENT_X + i * (cardW + gap);
        const numberColor = numberColorFor(i);
        const valueFontSize = fitFontSize(stat.value, cardW * 0.9, 1.4, numberFontSize, 24);
        return (
          <div key={i}>
            <Shape x={x} y={y} w={cardW} h={cardH} scale={scale} fill={hex(CARD_BG)} border={`1px solid ${hex(CARD_BORDER)}`} radius={CARD_RADIUS} shadow fieldPath={`stats[${i}].card`} layoutCtx={layoutCtx} interactive={interactive} />
            <TextBox
              x={x} y={y + 0.35} w={cardW} h={1.4} scale={scale} fontSize={valueFontSize} fontFamily={theme.fonts.header} color={numberColor} bold align="center" valign="middle"
              editable={interactive} onCommit={(t) => onCommitField?.(`stats[${i}].value`, t)}
              fieldPath={`stats[${i}].value`} layoutCtx={layoutCtx}
            >
              {stat.value}
            </TextBox>
            <TextBox
              x={x + 0.3} y={y + 1.75} w={cardW - 0.6} h={cardH - 1.85} scale={scale} fontSize={TYPE_SCALE.body} fontFamily={theme.fonts.body} color={MUTED} align="center"
              editable={interactive} onCommit={(t) => onCommitField?.(`stats[${i}].label`, t)}
              fieldPath={`stats[${i}].label`} layoutCtx={layoutCtx}
            >
              {stat.label}
            </TextBox>
          </div>
        );
      })}
    </>
  );
}

function ComparisonSlide({ slide, theme, scale, color, interactive, onCommitField, layoutCtx, style = PLAIN_STYLE }) {
  const items = slide.items;
  const hasHeroImage = !!slide.heroImage?.src;
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  const gap = 0.4;
  const colW = (contentW - gap * (items.length - 1)) / items.length;
  return (
    <>
      <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />
      <TitleText theme={theme} scale={scale} color={color} text={slide.title} interactive={interactive} onCommitField={onCommitField} layoutCtx={layoutCtx} w={contentW} />
      {items.map((item, i) => {
        const x = CONTENT_X + i * (colW + gap);
        const isDark = i % 2 === 1;
        // Only the light/even card varies by style — mirrors
        // src/lib/slides/layouts.js's buildComparisonSlide exactly ("bold"
        // is intentionally left plain white here, matching the white-card
        // look already used elsewhere for bold). "outline" has no fill, so
        // the effective background behind the text is the page's own
        // LIGHT_BG, not a real card color.
        const isOutline = style.shape === 'outline';
        const cardColor = isDark ? theme.palette.primary : (style.shape === 'warm' ? warmFillColor(theme) : CARD_BG);
        const textColor = contrastText(isDark ? cardColor : (isOutline ? LIGHT_BG : cardColor));
        const descY = BODY_Y + 1.05;
        const bulletsY = item.description ? descY + 0.65 : descY;
        return (
          <div key={i}>
            <Shape
              x={x} y={BODY_Y} w={colW} h={BODY_H} scale={scale}
              fill={isDark || !isOutline ? hex(cardColor) : undefined}
              border={isDark ? undefined : (isOutline ? `1.5px solid ${hex(ensureReadableOnLight(theme.palette.primary))}` : `1px solid ${hex(CARD_BORDER)}`)}
              radius={CARD_RADIUS} shadow={!isOutline} fieldPath={`items[${i}].card`} layoutCtx={layoutCtx} interactive={interactive}
            />
            <TextBox
              x={x + 0.3} y={BODY_Y + 0.35} w={colW - 0.6} h={0.6} scale={scale} fontSize={TYPE_SCALE.body + 4 + (style.boldLabel ? 2 : 0)} fontFamily={theme.fonts.header} color={textColor} bold
              editable={interactive} onCommit={(t) => onCommitField?.(`items[${i}].label`, t)}
              fieldPath={`items[${i}].label`} layoutCtx={layoutCtx}
            >
              {item.label}
            </TextBox>
            {item.description && (
              <TextBox
                x={x + 0.3} y={descY} w={colW - 0.6} h={0.6} scale={scale} fontSize={TYPE_SCALE.body} fontFamily={theme.fonts.body} color={textColor}
                editable={interactive} onCommit={(t) => onCommitField?.(`items[${i}].description`, t)}
                fieldPath={`items[${i}].description`} layoutCtx={layoutCtx}
              >
                {item.description}
              </TextBox>
            )}
            {item.bullets && item.bullets.length > 0 && (
              <BulletList
                bullets={item.bullets} x={x + 0.3} y={bulletsY} w={colW - 0.6} scale={scale} color={textColor} fontFamily={theme.fonts.body} fontSize={TYPE_SCALE.body}
                editable={interactive} onCommitBullet={(j, t) => onCommitField?.(`items[${i}].bullets[${j}]`, t)}
                fieldPath={`items[${i}].bullets`} layoutCtx={layoutCtx}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function TimelineSlide({ slide, theme, scale, color, interactive, onCommitField, layoutCtx }) {
  const items = slide.items;
  const hasHeroImage = !!slide.heroImage?.src;
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  const gap = 0.3;
  const stepW = (contentW - gap * (items.length - 1)) / items.length;
  const d = 0.6;
  const maxDescH = 1.3;
  const naturalH = d + 0.85 + maxDescH;
  const blockY = BODY_Y + Math.max(0, (BODY_H - naturalH) / 2);
  const lineY = blockY + d / 2;
  return (
    <>
      <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />
      <TitleText theme={theme} scale={scale} color={color} text={slide.title} interactive={interactive} onCommitField={onCommitField} layoutCtx={layoutCtx} w={contentW} />
      <Shape x={CONTENT_X + d / 2} y={lineY - 0.02} w={contentW - d} h={0.04} scale={scale} fill={hex(ensureReadableOnLight(theme.palette.secondary))} fieldPath="connector" layoutCtx={layoutCtx} interactive={interactive} />
      {items.map((item, i) => {
        const x = CONTENT_X + i * (stepW + gap);
        const dotColor = rotatingColor(theme, i);
        return (
          <div key={i}>
            <NumberedCircle
              number={i + 1} x={x} y={blockY} d={d} scale={scale}
              circleColor={dotColor} textColor={contrastText(dotColor)}
              fontSize={TYPE_SCALE.body} fontFamily={theme.fonts.body}
              fieldPath={`items[${i}].dot`} layoutCtx={layoutCtx} interactive={interactive}
            />
            <TextBox
              x={x} y={blockY + d + 0.25} w={stepW} h={0.6} scale={scale} fontSize={TYPE_SCALE.body} fontFamily={theme.fonts.body} color={color} bold
              editable={interactive} onCommit={(t) => onCommitField?.(`items[${i}].label`, t)}
              fieldPath={`items[${i}].label`} layoutCtx={layoutCtx}
            >
              {item.label}
            </TextBox>
            {item.description && (
              <TextBox
                x={x} y={blockY + d + 0.85} w={stepW} h={maxDescH} scale={scale} fontSize={TYPE_SCALE.caption + 1} fontFamily={theme.fonts.body} color={MUTED}
                editable={interactive} onCommit={(t) => onCommitField?.(`items[${i}].description`, t)}
                fieldPath={`items[${i}].description`} layoutCtx={layoutCtx}
              >
                {item.description}
              </TextBox>
            )}
          </div>
        );
      })}
    </>
  );
}

// quote/attribution are displayed with decorative curly-quote/em-dash
// wrapping baked into the rendered string — stripped back off on commit so
// re-editing doesn't accumulate extra quote marks/dashes each time.
function QuoteSlide({ slide, theme, scale, color, interactive, onCommitField, layoutCtx, style = PLAIN_STYLE }) {
  const hasHeroImage = !!slide.heroImage?.src;
  const textW = (hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W) - 1;
  return (
    <>
      <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />
      <TextBox
        x={CONTENT_X + 0.5} y={2.2} w={textW} h={2.6} scale={scale} fontSize={TYPE_SCALE.sectionHeader + 4 + (style.heroFontDelta ?? 0)} fontFamily={theme.fonts.header} color={color} italic valign="middle"
        editable={interactive} onCommit={(t) => onCommitField?.('quote', t.replace(/^[“"]+|[”"]+$/g, ''))}
        fieldPath="quote" layoutCtx={layoutCtx}
      >
        {`“${slide.quote}”`}
      </TextBox>
      {slide.attribution && (
        <TextBox
          x={CONTENT_X + 0.5} y={5.0} w={textW} h={0.6} scale={scale} fontSize={TYPE_SCALE.body + 2} fontFamily={theme.fonts.body} color={color}
          editable={interactive} onCommit={(t) => onCommitField?.('attribution', t.replace(/^—\s*/, ''))}
          fieldPath="attribution" layoutCtx={layoutCtx}
        >
          {`— ${slide.attribution}`}
        </TextBox>
      )}
    </>
  );
}

function toChartRows(chart) {
  return chart.categories.map((cat, i) => {
    const row = { name: cat };
    chart.series.forEach((s) => { row[s.name] = s.data[i] ?? null; });
    return row;
  });
}

function ChartSlide({ slide, theme, scale, color, interactive, onCommitField, layoutCtx }) {
  const { chart } = slide;
  const chartColors = [theme.palette.primary, theme.palette.secondary, theme.palette.accent].map(ensureReadableOnLight);
  const rows = toChartRows(chart);

  let body;
  if (chart.chartType === 'pie') {
    const pieRows = chart.categories
      .map((cat, i) => ({ name: cat, value: chart.series[0]?.data[i] }))
      .filter((r) => Number.isFinite(r.value));
    body = (
      <PieChart>
        <Pie data={pieRows} dataKey="value" nameKey="name" outerRadius="75%" label>
          {pieRows.map((entry, i) => <Cell key={i} fill={hex(chartColors[i % chartColors.length])} />)}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    );
  } else if (chart.chartType === 'line') {
    body = (
      <LineChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: `#${MUTED}`, fontSize: 11 }} />
        <YAxis tick={{ fill: `#${MUTED}`, fontSize: 11 }} />
        <Tooltip />
        {chart.series.length > 1 && <Legend />}
        {chart.series.map((s, i) => (
          <Line key={s.name} type="monotone" dataKey={s.name} stroke={hex(chartColors[i % chartColors.length])} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    );
  } else {
    body = (
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: `#${MUTED}`, fontSize: 11 }} />
        <YAxis tick={{ fill: `#${MUTED}`, fontSize: 11 }} />
        <Tooltip />
        {chart.series.length > 1 && <Legend />}
        {chart.series.length === 1 ? (
          <Bar dataKey={chart.series[0].name} radius={[4, 4, 0, 0]}>
            {rows.map((_, i) => <Cell key={i} fill={hex(chartColors[i % chartColors.length])} />)}
          </Bar>
        ) : (
          chart.series.map((s, i) => (
            <Bar key={s.name} dataKey={s.name} fill={hex(chartColors[i % chartColors.length])} radius={[4, 4, 0, 0]} />
          ))
        )}
      </BarChart>
    );
  }

  return (
    <>
      <TitleText theme={theme} scale={scale} color={color} text={slide.title} interactive={interactive} onCommitField={onCommitField} layoutCtx={layoutCtx} />
      <div style={{ position: 'absolute', left: inch(CONTENT_X, scale), top: inch(BODY_Y, scale), width: inch(CONTENT_W, scale), height: inch(BODY_H - 0.2, scale) }}>
        <ResponsiveContainer width="100%" height="100%">{body}</ResponsiveContainer>
      </div>
    </>
  );
}

// Mirrors src/lib/slides/layouts.js's buildTableSlide exactly — the header
// bar and row-divider lines are the table's own structural grid, not
// decorative chrome. No per-cell editing affordance (no TextBox/fieldPath),
// same scope decision as the export side.
// Deliberately its own bespoke pattern, not `Shape`/`TextBox` directly — a
// table is the one field made of real DOM children (header/cells) rather
// than a single flat box. It moves/resizes as ONE unit (fieldPath="table",
// same resolveBox-style override as every other field) while individual
// cells are only editable in place — click selects a cell (shows the same
// TextStyleToolbar every other text field gets, via `kind: 'text'`
// fieldDefaults), a second click/double-click edits it, but cells never get
// their own <Moveable> (TextBox's `interactiveTransform={false}`) so they
// can't drag independently of the table. Selecting the table itself (a
// click that doesn't land on a cell — TextBox already stopPropagation()s on
// click, so this only fires for empty table chrome) reports `undefined`
// fieldDefaults, same as Shape's own no-radius fields, so no floating
// toolbar pops up for "table selected," only for a selected cell.
//
// No rotation support for the table: pptxgenjs has no group-rotate
// primitive, so rotating this container in the live preview could not be
// faithfully reproduced on export (each cell would rotate around its own
// center independently, not as a rigid body) — omitting `rotatable` here
// keeps editor/export in sync, same discipline as the gradient-background
// rasterization workaround and the SVG-vs-clip-path shape choice.
//
// Resize is smooth for the table's own outline, but header/cell text only
// snaps to its new proportional position on release (onResizeEnd's
// re-render) rather than live-reflowing during the drag — unlike every
// other interactive field (a single flat box), this one has real children
// that don't auto-rescale with a raw width/height change. Known interim
// rough edge; a live CSS-transform-scale version is a possible follow-up.
function TableSlide({ slide, theme, scale, color, interactive, onCommitField, layoutCtx }) {
  const { headers, rows } = slide.table;
  const cols = headers.length;
  const hasHeroImage = !!slide.heroImage?.src;
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;

  const headerHDefault = 0.55;
  const maxRowH = 0.7;
  const rowsHDefault = Math.min(BODY_H - headerHDefault, maxRowH * rows.length);
  const tableYDefault = BODY_Y + Math.max(0, (BODY_H - (headerHDefault + rowsHDefault)) / 2);
  const headerFrac = headerHDefault / (headerHDefault + rowsHDefault);

  const ref = useRef(null);
  const fieldPath = 'table';
  const override = layoutCtx?.overrides?.[fieldPath];
  const effX = override?.x ?? CONTENT_X;
  const effY = override?.y ?? tableYDefault;
  const effW = override?.w ?? contentW;
  const effH = override?.h ?? (headerHDefault + rowsHDefault);
  const selected = !!(interactive && layoutCtx?.selectedFieldPath === fieldPath);

  const colW = effW / cols;
  const headerH = effH * headerFrac;
  const rowsH = effH - headerH;
  const rowH = rowsH / rows.length;

  const headerColor = ensureReadableOnLight(theme.palette.primary);
  const headerTextColor = contrastText(headerColor);

  const handleClick = (e) => {
    e.stopPropagation();
    layoutCtx?.onSelectField?.(fieldPath, undefined);
  };

  return (
    <>
      <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />
      <TitleText theme={theme} scale={scale} color={color} text={slide.title} interactive={interactive} onCommitField={onCommitField} layoutCtx={layoutCtx} w={contentW} />
      <div
        ref={ref}
        data-field-path={interactive ? fieldPath : undefined}
        onClick={interactive ? handleClick : undefined}
        style={{
          position: 'absolute', left: inch(effX, scale), top: inch(effY, scale), width: inch(effW, scale), height: inch(effH, scale),
          cursor: interactive ? 'pointer' : undefined,
          outline: selected ? '2px solid #3B82F6' : undefined, outlineOffset: selected ? 2 : undefined,
        }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0, width: inch(effW, scale), height: inch(headerH, scale), background: hex(headerColor) }} />
        {headers.map((h, i) => (
          <TextBox
            key={`h${i}`}
            x={i * colW + 0.15} y={0} w={colW - 0.3} h={headerH} scale={scale}
            fontSize={TYPE_SCALE.body} fontFamily={theme.fonts.body} color={headerTextColor} bold
            editable={interactive} interactiveTransform={false}
            onCommit={(t) => onCommitField?.(`table.headers[${i}]`, t)}
            fieldPath={`table.headers[${i}]`} layoutCtx={layoutCtx}
          >
            {h}
          </TextBox>
        ))}
        {rows.map((row, r) => {
          const rowY = headerH + r * rowH;
          return (
            <div key={r}>
              {r > 0 && (
                <div style={{ position: 'absolute', left: 0, top: inch(rowY, scale), width: inch(effW, scale), height: 1, background: hex(CARD_BORDER) }} />
              )}
              {row.map((cell, c) => (
                <TextBox
                  key={c}
                  x={c * colW + 0.15} y={rowY} w={colW - 0.3} h={rowH} scale={scale}
                  fontSize={TYPE_SCALE.body} fontFamily={theme.fonts.body} color={MUTED}
                  editable={interactive} interactiveTransform={false}
                  onCommit={(t) => onCommitField?.(`table.rows[${r}][${c}]`, t)}
                  fieldPath={`table.rows[${r}][${c}]`} layoutCtx={layoutCtx}
                >
                  {cell}
                </TextBox>
              ))}
            </div>
          );
        })}
      </div>
      {selected && (
        <Moveable
          target={ref}
          draggable
          resizable
          origin={false}
          onDrag={({ target, left, top }) => {
            target.style.left = `${left}px`;
            target.style.top = `${top}px`;
          }}
          onDragEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const nx = (parseFloat(target.style.left) || 0) / scale;
            const ny = (parseFloat(target.style.top) || 0) / scale;
            layoutCtx.onCommitFieldOverride?.(fieldPath, { x: nx, y: ny });
          }}
          onResize={({ target, width, height, drag }) => {
            const minW = scale * 1.5;
            const minH = scale * 0.5;
            target.style.width = `${Math.max(minW, width)}px`;
            target.style.height = `${Math.max(minH, height)}px`;
            target.style.left = `${drag.left}px`;
            target.style.top = `${drag.top}px`;
          }}
          onResizeEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const nw = (parseFloat(target.style.width) || 0) / scale;
            const nh = (parseFloat(target.style.height) || 0) / scale;
            const nx = (parseFloat(target.style.left) || 0) / scale;
            const ny = (parseFloat(target.style.top) || 0) / scale;
            layoutCtx.onCommitFieldOverride?.(fieldPath, { x: nx, y: ny, w: nw, h: nh });
          }}
        />
      )}
    </>
  );
}

// Mirrors src/lib/slides/layouts.js's buildProcessStepsSlide exactly —
// single-column counterpart to timeline (same relationship icon_list has to
// icon_grid), stacked vertically with a connecting line, numbered circles
// instead of icon glyphs.
function ProcessStepsSlide({ slide, theme, scale, color, interactive, onCommitField, layoutCtx }) {
  const items = slide.items;
  const d = 0.5;
  const gap = 0.25;
  const rowH = Math.min(1.1, (BODY_H - gap * (items.length - 1)) / items.length);
  const startY = BODY_Y + Math.max(0, (BODY_H - (rowH * items.length + gap * (items.length - 1))) / 2);
  const lineX = CONTENT_X + d / 2;
  const firstCenterY = startY + d / 2;
  const lastCenterY = startY + (items.length - 1) * (rowH + gap) + d / 2;
  const hasHeroImage = !!slide.heroImage?.src;
  const contentW = hasHeroImage ? CONTENT_W - HERO_IMAGE_PANEL_W - 0.4 : CONTENT_W;
  const textX = CONTENT_X + d + 0.4;
  const textW = contentW - d - 0.4;
  return (
    <>
      <HeroImage slide={slide} scale={scale} interactive={interactive} layoutCtx={layoutCtx} />
      <TitleText theme={theme} scale={scale} color={color} text={slide.title} interactive={interactive} onCommitField={onCommitField} layoutCtx={layoutCtx} w={contentW} />
      <div style={{
        position: 'absolute', left: inch(lineX - 0.02, scale), top: inch(firstCenterY, scale),
        width: inch(0.04, scale), height: inch(Math.max(0, lastCenterY - firstCenterY), scale),
        background: hex(ensureReadableOnLight(theme.palette.secondary)),
      }} />
      {items.map((item, i) => {
        const y = startY + i * (rowH + gap);
        const dotColor = rotatingColor(theme, i);
        return (
          <div key={i}>
            <NumberedCircle
              number={i + 1} x={CONTENT_X} y={y} d={d} scale={scale}
              circleColor={dotColor} textColor={contrastText(dotColor)}
              fontSize={TYPE_SCALE.body} fontFamily={theme.fonts.body}
              fieldPath={`items[${i}].dot`} layoutCtx={layoutCtx} interactive={interactive}
            />
            <TextBox
              x={textX} y={y} w={textW} h={0.4} scale={scale} fontSize={TYPE_SCALE.body + 1} fontFamily={theme.fonts.body} color={color} bold
              editable={interactive} onCommit={(t) => onCommitField?.(`items[${i}].label`, t)}
              fieldPath={`items[${i}].label`} layoutCtx={layoutCtx}
            >
              {item.label}
            </TextBox>
            {item.description && (
              <TextBox
                x={textX} y={y + 0.4} w={textW} h={Math.max(0, rowH - 0.45)} scale={scale} fontSize={TYPE_SCALE.body - 1} fontFamily={theme.fonts.body} color={MUTED}
                editable={interactive} onCommit={(t) => onCommitField?.(`items[${i}].description`, t)}
                fieldPath={`items[${i}].description`} layoutCtx={layoutCtx}
              >
                {item.description}
              </TextBox>
            )}
          </div>
        );
      })}
    </>
  );
}

// One freeform (Canva-style) element, positioned absolutely in the same
// inch-space as every other primitive here.
//
// Selection vs. editing are two distinct states: a first click only
// *selects* an element, showing its blue outline. A second click on an
// already-*solo*-selected text element (or a double-click) enters *edit*
// mode (contentEditable, caret placed at the end via the effect below).
// This split exists because a contentEditable target and a Moveable drag
// target can't cleanly share one click. Shapes have no edit mode.
//
// Multi-select is layered on top of this: `selected` (this element is one
// of possibly several selected — shows the blue outline) is distinct from
// `solo` (this element is the ONLY one selected — drives the
// react-moveable drag/resize/rotate handles and, for text, the click-again-
// to-edit behavior). Group drag/resize isn't implemented — dragging a
// multi-selection isn't possible, only aligning/distributing it (see the
// align/distribute toolbar in SlideDeckEditor.jsx) — so Moveable only
// mounts when exactly one element is selected. A plain click on any element
// always collapses the selection down to just that element (standard
// design-tool behavior); shift-click toggles it into/out of the current
// multi-selection instead.
//
// Drag/resize/rotate commit only on gesture-end (not every frame) — see
// the on*End handlers below — matching the optimistic-update-then-rollback
// pattern used everywhere else in SlideDeckEditor.jsx. `interactive` is only
// ever true for the main center preview (see SlideDeckEditor.jsx) —
// thumbnails and the presentation-mode overlay always render elements inert.
function FreeformElement({ el, scale, interactive, selected, solo, editing, onSelect, onToggleSelect, onStartEditing, onCommitText, onCommitTransform, onRegisterNode, getGuidelineNodes }) {
  const ref = useRef(null);
  const isTextEditing = interactive && editing && el.kind === 'text';
  // Whether the CURRENT resize gesture (if any) is locking aspect ratio —
  // only ever true for a text element's CORNER handle (see the Moveable
  // block below); shapes keep their existing free/independent resize on
  // every handle.
  const [keepRatio, setKeepRatio] = useState(false);

  useEffect(() => {
    if (!isTextEditing || !ref.current) return;
    ref.current.focus();
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTextEditing]);

  // Registers this element's DOM node with the parent (FreeformLayer) so
  // snapping can offer every OTHER element's edges as guidelines (via
  // getGuidelineNodes below) without each element needing to know about its
  // siblings directly.
  useEffect(() => {
    onRegisterNode?.(el.id, ref.current);
    return () => onRegisterNode?.(el.id, null);
  }, [el.id, onRegisterNode]);

  const common = {
    position: 'absolute', left: inch(el.x, scale), top: inch(el.y, scale),
    width: inch(el.w, scale), height: inch(el.h, scale),
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    boxSizing: 'border-box',
    cursor: !interactive ? undefined : isTextEditing ? 'text' : solo ? 'move' : el.kind === 'text' ? 'text' : 'pointer',
    outline: selected ? '2px solid #3B82F6' : undefined,
    outlineOffset: selected ? 2 : undefined,
  };
  // Shift-click toggles multi-selection. A plain click either selects this
  // element solo (collapsing any existing multi-selection down to just this
  // one) or, if it's already the sole selection, starts editing it (text
  // only) — see the block comment above.
  const handleClick = interactive
    ? (e) => {
        e.stopPropagation();
        if (e.shiftKey) {
          onToggleSelect?.();
        } else if (!solo) {
          onSelect?.();
        } else if (el.kind === 'text' && !isTextEditing) {
          onStartEditing?.();
        }
      }
    : undefined;
  const handleDoubleClick = interactive && el.kind === 'text'
    ? (e) => { e.stopPropagation(); onSelect?.(); onStartEditing?.(); }
    : undefined;

  let node;
  if (el.kind === 'text') {
    node = (
      <div
        ref={ref}
        data-freeform-id={el.id}
        contentEditable={isTextEditing}
        suppressContentEditableWarning={isTextEditing}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onBlur={isTextEditing ? (e) => onCommitText?.(e.currentTarget.textContent || '') : undefined}
        style={{
          ...common, overflow: 'hidden', whiteSpace: 'pre-wrap',
          fontSize: pt(el.fontSize, scale), fontFamily: el.fontFamily, color: hex(el.color),
          fontWeight: el.bold ? 700 : 400, fontStyle: el.italic ? 'italic' : 'normal',
          textAlign: el.align || 'left', lineHeight: 1.25,
        }}
      >
        {el.text}
      </div>
    );
  } else if (el.kind === 'line') {
    // strokeWidth is stored in POINTS (matching src/lib/slides/layouts.js's
    // PptxGenJS line width, and matching how fontSize is already handled
    // above) — converted through inches at the current scale, same as every
    // other size on this element, so it actually scales with zoom instead of
    // staying a fixed screen pixel count. `?? 2` (not `|| 2`) so an
    // explicit strokeWidth of 0 isn't silently bumped up to the default.
    node = (
      <div
        ref={ref}
        data-freeform-id={el.id}
        onClick={handleClick}
        style={{ ...common, borderTop: `${Math.max(1, inch((el.strokeWidth ?? 2) / 72, scale))}px solid ${hex(el.stroke) || '#1A1A1A'}` }}
      />
    );
  } else if (el.kind === 'image') {
    node = (
      <img
        ref={ref}
        data-freeform-id={el.id}
        src={el.src}
        alt=""
        draggable={false}
        onClick={handleClick}
        style={{ ...common, objectFit: 'cover', opacity: Number.isFinite(el.opacity) ? el.opacity : 1 }}
      />
    );
  } else if (SHAPE_POLYGON_POINTS[el.kind]) {
    // Basic polygon shapes — SVG, not a CSS clip-path div (see
    // SHAPE_POLYGON_POINTS' comment above for why). vectorEffect=
    // "non-scaling-stroke" keeps the stroke a constant physical width
    // regardless of the box's own aspect ratio, matching how rect/ellipse's
    // border-width below is already a fixed px value independent of w/h.
    const strokeWidthPx = el.stroke ? Math.max(1, inch((el.strokeWidth ?? 1) / 72, scale)) : 0;
    node = (
      <svg
        ref={ref}
        data-freeform-id={el.id}
        onClick={handleClick}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ ...common, opacity: Number.isFinite(el.opacity) ? el.opacity : 1 }}
      >
        <polygon
          points={SHAPE_POLYGON_POINTS[el.kind]}
          fill={el.fill ? hex(el.fill) : 'none'}
          stroke={el.stroke ? hex(el.stroke) : 'none'}
          strokeWidth={strokeWidthPx}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  } else {
    // rect / ellipse / roundRect. `opacity` fades the WHOLE element (fill +
    // border together) — src/lib/slides/layouts.js's PPTX writer mirrors
    // this by applying the same transparency to both fill and line, not
    // just fill. Border width goes through the same points-to-scaled-px
    // conversion as the line case above, for the same reason.
    node = (
      <div
        ref={ref}
        data-freeform-id={el.id}
        onClick={handleClick}
        style={{
          ...common,
          background: el.fill ? hex(el.fill) : 'transparent',
          border: el.stroke ? `${Math.max(1, inch((el.strokeWidth ?? 1) / 72, scale))}px solid ${hex(el.stroke)}` : undefined,
          borderRadius: el.kind === 'ellipse' ? '50%' : el.kind === 'roundRect' ? inch(SHAPE_ROUND_RADIUS, scale) : undefined,
          opacity: Number.isFinite(el.opacity) ? el.opacity : 1,
        }}
      />
    );
  }

  return (
    <>
      {node}
      {interactive && solo && !isTextEditing && (
        <Moveable
          target={ref}
          draggable
          resizable
          rotatable
          origin={false}
          // Images always lock aspect ratio on every handle (unlike text,
          // which only locks on a CORNER drag, and shapes, which never
          // lock) — a stretched/squashed photo looks broken, same reasoning
          // as InteractiveCircle's unconditional keepRatio for icons.
          keepRatio={keepRatio || el.kind === 'image'}
          throttleRotate={1}
          // Snapping — snaps the dragged element's own edges/center/middle
          // to the slide's edges/center (verticalGuidelines/
          // horizontalGuidelines, in the same px-per-inch space as
          // everything else here) and to every OTHER element's edges/
          // center on this slide (elementGuidelines, collected via the node
          // registry above). snapContainer/container are left unset so
          // Moveable falls back to the target's parentElement — the
          // SlideRenderer root div — which is exactly the coordinate space
          // these guideline values are already expressed in.
          snappable
          snapDirections={{ top: true, right: true, bottom: true, left: true, center: true, middle: true }}
          elementSnapDirections={{ top: true, right: true, bottom: true, left: true, center: true, middle: true }}
          verticalGuidelines={[0, inch(SLIDE_W / 2, scale), inch(SLIDE_W, scale)]}
          horizontalGuidelines={[0, inch(SLIDE_H / 2, scale), inch(SLIDE_H, scale)]}
          elementGuidelines={getGuidelineNodes ? getGuidelineNodes(el.id) : []}
          snapThreshold={5}
          isDisplaySnapDigit={false}
          onDrag={({ target, left, top }) => {
            target.style.left = `${left}px`;
            target.style.top = `${top}px`;
          }}
          onDragEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const x = (parseFloat(target.style.left) || 0) / scale;
            const y = (parseFloat(target.style.top) || 0) / scale;
            onCommitTransform?.({ x, y });
          }}
          // A CORNER handle on a TEXT element locks aspect ratio for this
          // gesture (via `keepRatio` above, flipped here before Moveable
          // computes its first resize frame) so a "grow" drag enlarges width
          // AND height together instead of letting the box get arbitrarily
          // distorted — an earlier version tried to reverse-engineer a
          // single fontSize from an already-distorted box (area ratio, then
          // min(w,h) ratio) and both failed: area-based over-grew the font
          // past what a width-dominant drag's HEIGHT could fit (text got
          // clipped by this element's `overflow: hidden`); min-based then
          // barely grew the font at all on that same width-dominant drag,
          // since the near-unchanged height ratio always won. Locking the
          // ratio up front avoids the ambiguity entirely. Shapes (and a
          // text element's side/edge handles) leave keepRatio false, so
          // resize on them stays free/independent.
          onResizeStart={({ direction }) => {
            setKeepRatio(el.kind === 'text' && direction[0] !== 0 && direction[1] !== 0);
          }}
          // Minimum size is a small fraction of an inch (scaled to the
          // current zoom's px-per-inch), not a raw pixel floor, so it stays
          // a sensible physical size at any zoom level. Every handle
          // (including top/left ones) reports `drag.left/top` alongside the
          // new width/height so the opposite edge/corner stays anchored —
          // without applying it, resizing from a top or left handle would
          // grow the box in the wrong direction.
          onResize={({ target, width, height, drag }) => {
            const minW = scale * 0.3;
            const minH = el.kind === 'line' ? 0 : scale * 0.2;
            target.style.width = `${Math.max(minW, width)}px`;
            target.style.height = `${Math.max(minH, height)}px`;
            target.style.left = `${drag.left}px`;
            target.style.top = `${drag.top}px`;
          }}
          onResizeEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const w = (parseFloat(target.style.width) || 0) / scale;
            const h = (parseFloat(target.style.height) || 0) / scale;
            const x = (parseFloat(target.style.left) || 0) / scale;
            const y = (parseFloat(target.style.top) || 0) / scale;
            const patch = { x, y, w, h };
            if (keepRatio && el.kind === 'text' && el.w > 0 && el.h > 0) {
              const scaleRatio = ((w / el.w) + (h / el.h)) / 2;
              patch.fontSize = Math.max(6, Math.min(200, Math.round(el.fontSize * scaleRatio)));
            }
            setKeepRatio(false);
            onCommitTransform?.(patch);
          }}
          // Rotates in place around the target's own center (the browser's
          // default transform-origin), so — unlike drag/resize — left/top
          // never need adjusting here.
          onRotate={({ target, rotate }) => {
            target.style.transform = `rotate(${rotate}deg)`;
          }}
          onRotateEnd={({ target, isDrag }) => {
            if (!isDrag) return;
            const match = /rotate\(([-\d.]+)deg\)/.exec(target.style.transform || '');
            const raw = match ? parseFloat(match[1]) : 0;
            // Moveable accumulates past a full turn if you spin it more than
            // once — normalize to (-180, 180] so a value that's spun around
            // twice doesn't get stored as e.g. 725deg.
            const normalized = Math.round(((raw + 180) % 360 + 360) % 360 - 180);
            onCommitTransform?.({ rotation: normalized });
          }}
        />
      )}
    </>
  );
}

function FreeformLayer({
  elements, scale, interactive, selectedElementIds = [], editingElementId,
  onSelectElement, onToggleSelectElement, onStartEditingElement, onCommitElementText, onCommitElementTransform,
}) {
  // Registry of every element's DOM node on this slide, keyed by id — lets
  // snapping offer every OTHER element as a guideline (see getGuidelineNodes
  // below) without a full re-render each time one registers. Declared
  // before the early return below to keep hook order stable regardless of
  // whether `elements` is empty.
  const nodeMapRef = useRef(new Map());
  if (!Array.isArray(elements) || elements.length === 0) return null;
  const sorted = [...elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  const soloSelectedId = selectedElementIds.length === 1 ? selectedElementIds[0] : null;
  const registerNode = (id, node) => {
    if (node) nodeMapRef.current.set(id, node);
    else nodeMapRef.current.delete(id);
  };
  const getGuidelineNodes = (id) => Array.from(nodeMapRef.current.entries()).filter(([elId]) => elId !== id).map(([, node]) => node);
  return sorted.map((el) => (
    <FreeformElement
      key={el.id}
      el={el}
      scale={scale}
      interactive={interactive}
      selected={interactive && selectedElementIds.includes(el.id)}
      solo={interactive && el.id === soloSelectedId}
      editing={interactive && el.id === editingElementId}
      onRegisterNode={registerNode}
      getGuidelineNodes={getGuidelineNodes}
      onSelect={onSelectElement ? () => onSelectElement(el.id) : undefined}
      onToggleSelect={onToggleSelectElement ? () => onToggleSelectElement(el.id) : undefined}
      onStartEditing={onStartEditingElement ? () => onStartEditingElement(el.id) : undefined}
      onCommitText={onCommitElementText ? (text) => onCommitElementText(el.id, text) : undefined}
      onCommitTransform={onCommitElementTransform ? (patch) => onCommitElementTransform(el.id, patch) : undefined}
    />
  ));
}

const LAYOUT_COMPONENTS = {
  title: TitleSlide,
  agenda: AgendaSlide,
  section_header: SectionHeaderSlide,
  bullets: BulletsSlide,
  two_column: TwoColumnSlide,
  icon_grid: IconGridSlide,
  icon_list: IconListSlide,
  feature_split: FeatureSplitSlide,
  stat_callout: StatCalloutSlide,
  comparison: ComparisonSlide,
  timeline: TimelineSlide,
  chart: ChartSlide,
  quote: QuoteSlide,
  closing: ClosingSlide,
  table: TableSlide,
  process_steps: ProcessStepsSlide,
};

// Additive corner-logo box for a brand kit — sized from the logo's real
// aspect ratio, same 0.55in/1.8in caps as src/lib/slides/buildDeck.js's
// drawBrandLogo so the preview matches the exported .pptx. Kept at the
// shared wrapper level (not inside any per-type component) so it never
// touches a slide type's own layout math.
function brandLogoBox(logo) {
  if (!logo?.url) return null;
  const maxH = 0.55;
  const maxW = 1.8;
  let w = maxH;
  let h = maxH;
  if (logo.width && logo.height) {
    const ratio = logo.width / logo.height;
    if (ratio >= 1) {
      w = Math.min(maxW, maxH * ratio);
      h = w / ratio;
    } else {
      h = maxH;
      w = h * ratio;
    }
  }
  return { url: logo.url, w, h, x: SLIDE_W - MARGIN - w, y: SLIDE_H - MARGIN - h };
}

export default function SlideRenderer({
  slide, theme, scale, slideIndex = 0,
  interactiveElements = false, selectedElementIds = [], editingElementId = null,
  onSelectElement, onToggleSelectElement, onStartEditingElement, onCommitElementText, onCommitElementTransform, onCommitField,
  // Template content transform overrides. `selectedFieldPath`/
  // `editingFieldPath` are strings (a single field, not multi-select — see
  // SlideDeckEditor.jsx), analogous to selectedElementIds/editingElementId
  // above but for template text instead of freeform elements.
  selectedFieldPath = null, editingFieldPath = null, onSelectField, onStartEditingField, onCommitFieldOverride,
}) {
  if (!slide || !theme) return null;
  const Comp = LAYOUT_COMPONENTS[slide.type];
  if (!Comp) {
    console.error(`SlideRenderer: no preview component registered for slide type "${slide.type}" — mirrors src/lib/slides/layouts.js's LAYOUT_BUILDERS, check both are in sync.`);
    return null;
  }

  // Resolved from theme.presentationType via the SAME getStyle() the
  // PptxGenJS export path uses (src/lib/slides/theme.js) — a single shared
  // source so this preview and the exported .pptx can never drift apart.
  const style = getStyle(theme);
  const isDark = DARK_TYPES.has(slide.type);
  // slide.backgroundColor (set via the left tools panel's Background tool,
  // never by the LLM — see src/lib/slides/outline.js) overrides the
  // template default — either a solid hex string or a 2-stop gradient
  // descriptor { type: 'gradient', angle, stops: [hexA, hexB] }. Template
  // text color is computed against this EFFECTIVE background, not always
  // the theme default — otherwise a light custom background under a "dark"
  // slide type (or vice versa) would leave template text unreadable
  // (mirrors the same fix in src/lib/slides/layouts.js's addBackground()).
  // For a gradient, contrast is computed against the midpoint of its two
  // stops.
  const bg = slide.backgroundColor;
  const isGradientBg = bg && typeof bg === 'object' && bg.type === 'gradient';
  const bgColor = isGradientBg ? mixHex(bg.stops[0], bg.stops[1], 0.5) : (bg || (isDark ? theme.palette.primary : LIGHT_BG));
  const textColor = contrastText(bgColor);
  const logoBox = brandLogoBox(theme.logo);
  // `overrides` is always read (thumbnails/presentation included, so a
  // moved field stays moved everywhere) — the selection/editing state and
  // handlers are only meaningful in the interactive main preview, and are
  // simply unused (never read, since selectedFieldPath/editingFieldPath
  // default to null) when interactiveElements is false.
  const layoutCtx = {
    overrides: slide.layoutOverrides || {},
    selectedFieldPath: interactiveElements ? selectedFieldPath : null,
    editingFieldPath: interactiveElements ? editingFieldPath : null,
    onSelectField, onStartEditingField, onCommitFieldOverride,
  };

  return (
    <div
      style={{
        position: 'relative', width: inch(SLIDE_W, scale), height: inch(SLIDE_H, scale),
        overflow: 'hidden',
        background: isGradientBg ? `linear-gradient(${bg.angle}deg, ${hex(bg.stops[0])}, ${hex(bg.stops[1])})` : hex(bgColor),
        fontFamily: theme.fonts.body,
        boxSizing: 'border-box', flexShrink: 0,
      }}
    >
      {isDark && <DecorativeCircles theme={theme} scale={scale} style={style} />}
      <Comp slide={slide} theme={theme} scale={scale} color={textColor} slideIndex={slideIndex} interactive={interactiveElements} onCommitField={onCommitField} layoutCtx={layoutCtx} style={style} />
      <FreeformLayer
        elements={slide.elements}
        scale={scale}
        interactive={interactiveElements}
        selectedElementIds={selectedElementIds}
        editingElementId={editingElementId}
        onSelectElement={onSelectElement}
        onToggleSelectElement={onToggleSelectElement}
        onStartEditingElement={onStartEditingElement}
        onCommitElementText={onCommitElementText}
        onCommitElementTransform={onCommitElementTransform}
      />
      {logoBox && (
        <img
          src={logoBox.url}
          alt=""
          style={{
            position: 'absolute', left: inch(logoBox.x, scale), top: inch(logoBox.y, scale),
            width: inch(logoBox.w, scale), height: inch(logoBox.h, scale), objectFit: 'contain',
          }}
        />
      )}
    </div>
  );
}
