'use client';
import { useEffect, useRef, useState } from 'react';
import Selecto from 'react-selecto';
import {
  ArrowLeft, Layers, FileText, Send, Loader2, Presentation, RefreshCw, Play, ChevronLeft, ChevronRight, X,
  Bold, Italic, AlignLeft, AlignCenter, AlignRight, Minus, Plus, Copy, Trash2, BringToFront, SendToBack, Upload,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { resolveTheme, PALETTES, SLIDE_W, SLIDE_H } from '@/lib/slides/theme.js';
import SlideRenderer from './renderer/SlideRenderer';
import ThemeSelector from './ThemeSelector';
import SlideThumbnailRail from './SlideThumbnailRail';
import LeftToolsPanel from './toolbar/LeftToolsPanel';
import TextPanel from './toolbar/TextPanel';
import ShapesPanel from './toolbar/ShapesPanel';
import UploadsPanel from './toolbar/UploadsPanel';
import BackgroundPanel from './toolbar/BackgroundPanel';

const POLL_INTERVAL_MS = 3000;

// Mirrors src/lib/slides/elements.js's DEFAULT_ELEMENT_BY_KIND — duplicated
// here (not imported) since that file uses Node's "crypto" module and this
// component runs in the browser bundle. The layout-patch route still
// re-clamps/validates whatever is sent, so drift here is defense-in-depth
// only, not a correctness requirement.
const TEXT_ELEMENT_DEFAULTS = { w: 3, h: 1, text: 'Text', fontSize: 18, fontFamily: 'Calibri', color: '1A1A1A', align: 'left', bold: false, italic: false };
const SHAPE_ELEMENT_DEFAULTS = {
  rect: { w: 2, h: 1.2, fill: 'CADCFC', stroke: null, strokeWidth: 1, opacity: 1 },
  ellipse: { w: 2, h: 2, fill: 'CADCFC', stroke: null, strokeWidth: 1, opacity: 1 },
  line: { w: 3, h: 0, fill: null, stroke: '1A1A1A', strokeWidth: 2, opacity: 1 },
  triangle: { w: 2, h: 1.8, fill: 'CADCFC', stroke: null, strokeWidth: 1, opacity: 1 },
  diamond: { w: 2, h: 2, fill: 'CADCFC', stroke: null, strokeWidth: 1, opacity: 1 },
  pentagon: { w: 2, h: 1.9, fill: 'CADCFC', stroke: null, strokeWidth: 1, opacity: 1 },
  hexagon: { w: 2.2, h: 1.9, fill: 'CADCFC', stroke: null, strokeWidth: 1, opacity: 1 },
  star: { w: 2, h: 2, fill: 'CADCFC', stroke: null, strokeWidth: 1, opacity: 1 },
  rightArrow: { w: 2.4, h: 1.2, fill: 'CADCFC', stroke: null, strokeWidth: 1, opacity: 1 },
  roundRect: { w: 2, h: 1.2, fill: 'CADCFC', stroke: null, strokeWidth: 1, opacity: 1 },
  octagon: { w: 2, h: 2, fill: 'CADCFC', stroke: null, strokeWidth: 1, opacity: 1 },
  parallelogram: { w: 2.2, h: 1.2, fill: 'CADCFC', stroke: null, strokeWidth: 1, opacity: 1 },
};
// TextPanel's "Default text styles" presets — same generic {kind:'text',
// ...defaults} insert path as the plain "Add a text box" button, just
// different starting fontSize/bold/box size.
const TEXT_PRESET_DEFAULTS = {
  default: TEXT_ELEMENT_DEFAULTS,
  heading: { ...TEXT_ELEMENT_DEFAULTS, text: 'Heading', fontSize: 36, bold: true, w: 4, h: 1 },
  subheading: { ...TEXT_ELEMENT_DEFAULTS, text: 'Subheading', fontSize: 24, bold: true, w: 4, h: 0.8 },
  body: { ...TEXT_ELEMENT_DEFAULTS, text: 'Body text', fontSize: 14, w: 3.5, h: 1 },
};

// Arrow-key nudge distances (inches).
const NUDGE_STEP = 0.05;
const NUDGE_STEP_LARGE = 0.25;
// Session-local undo/redo: rapid-fire changes to the same thing within this
// window (a continuous color-picker drag, a burst of digits typed into a
// size field) coalesce into one undo entry instead of one per underlying
// event — see pushUndoSnapshot below.
const UNDO_COALESCE_MS = 500;
const UNDO_STACK_LIMIT = 50;

// Clones a set of freeform elements with a small offset so the copies are
// visibly distinct from their originals and placed above them in stacking
// order — shared by duplicate (Ctrl/Cmd+D) and paste (Ctrl/Cmd+V), which are
// otherwise the same operation with a different source list.
function cloneElementsWithOffset(elements, offset, startZIndex) {
  return elements.map((el, i) => ({
    ...el,
    id: crypto.randomUUID(),
    x: Math.min(SLIDE_W - el.w, el.x + offset),
    y: Math.min(SLIDE_H - el.h, el.y + offset),
    zIndex: startZIndex + i,
  }));
}

// Moves selectedIndex along with a slide that's been dragged from `from` to
// `to`, or shifts it if it fell inside the range that closed up around the
// move — so "Current Slide" edit mode never silently points at the wrong
// slide after a drag.
function indexAfterMove(selected, from, to) {
  if (selected === from) return to;
  if (from < to && selected > from && selected <= to) return selected - 1;
  if (from > to && selected >= to && selected < from) return selected + 1;
  return selected;
}

// Turns a "items[1].label" style path (as built by SlideRenderer's per-type
// components — see fieldPath usage there) into an immutable deep update, so
// editing one nested field never mutates the rest of the slide's shared
// object graph. "items[1].label" -> tokens ["items","1","label"].
function parsePathTokens(path) {
  return path.match(/[^.[\]]+/g) || [];
}

function setDeepValue(obj, path, value) {
  const keys = parsePathTokens(path);
  const clone = Array.isArray(obj) ? [...obj] : { ...obj };
  let cursor = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = cursor[key];
    cursor[key] = Array.isArray(next) ? [...next] : (next && typeof next === 'object' ? { ...next } : {});
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
  return clone;
}

// A selected template fieldPath is "deletable" only if it addresses one
// entry of a repeatable array field (an icon_list/icon_grid/timeline/
// comparison/process_steps item, a bullet, a stat, or a table row) — never a
// scalar field like title/subtitle/quote (there's nothing to remove one OF)
// or a sub-part of the table itself like a header cell (removing a column
// would need to touch every row, out of scope here — only row deletion is
// supported). Matches regardless of which sub-part of the item was actually
// clicked (`items[2].card`, `items[2].icon`, `items[2].label`, plain
// `items[2]`, ...) since deleting "this content" should remove the whole
// logical item, not just the one sub-field that happened to be selected.
function parseDeletableFieldPath(fieldPath) {
  if (!fieldPath) return null;
  let m = fieldPath.match(/^table\.rows\[(\d+)\](?:\[\d+\])?$/);
  if (m) return { kind: 'table-row', index: Number(m[1]) };
  m = fieldPath.match(/^(items|bullets|stats)\[(\d+)\](?:\..+)?$/);
  if (m) return { kind: 'array-item', field: m[1], index: Number(m[2]) };
  return null;
}

// After removing index `deletedIndex` from the array field addressed by
// `prefix` (e.g. "items" or "table.rows"), every OTHER layoutOverrides key
// under that same prefix needs to move with its item: the deleted item's own
// overrides (`${prefix}[deletedIndex]...`) are dropped entirely, and every
// later index shifts down by one so e.g. `items[3].card`'s override doesn't
// silently end up applied to the item that used to be at index 2. Keys
// outside this prefix (title, other array fields, ...) pass through
// untouched.
function remapOverridesAfterArrayDelete(overrides, prefix, deletedIndex) {
  const re = new RegExp(`^${prefix.replace(/\./g, '\\.')}\\[(\\d+)\\](.*)$`);
  const next = {};
  for (const [key, value] of Object.entries(overrides || {})) {
    const m = key.match(re);
    if (!m) { next[key] = value; continue; }
    const idx = Number(m[1]);
    if (idx === deletedIndex) continue;
    const newIdx = idx > deletedIndex ? idx - 1 : idx;
    next[`${prefix}[${newIdx}]${m[2]}`] = value;
  }
  return next;
}

// Duplicate / bring-forward / send-backward / delete — shared by both the
// text and shape floating toolbars below, since every freeform element kind
// supports the same selection actions.
function ElementActionButtons({ onDuplicate, onReorderLayer, onDelete, disabled }) {
  return (
    <>
      <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />
      <button
        type="button"
        onClick={onDuplicate}
        disabled={disabled}
        title="Duplicate"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onReorderLayer('forward')}
        disabled={disabled}
        title="Bring forward"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <BringToFront className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onReorderLayer('backward')}
        disabled={disabled}
        title="Send backward"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <SendToBack className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        title="Delete"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </>
  );
}

// Single delete button, shared by the text/shape template-field toolbars
// below — rendered only when the selected field is actually a deletable
// array item (see parseDeletableFieldPath); a scalar field like title never
// gets this. Deliberately not folded into ElementActionButtons above: that
// one is freeform-only (duplicate/layer/delete), while a template field only
// ever supports delete — there's no z-order or independent duplicate for one
// item within an AI-generated list.
function DeleteFieldAction({ onClick, disabled }) {
  return (
    <>
      <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title="Delete"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </>
  );
}

// The floating Canva-style text style toolbar — fontSize +/-, color, bold,
// italic, align. Shared by BOTH freeform text elements and template content
// fields (title/bullets/item labels/...) so the two feel identical to edit,
// not like two different text systems — the caller supplies the current
// effective style and the callbacks that write it back to whichever store
// (elements[] vs layoutOverrides) actually owns that text. `actions` renders
// after the align buttons — ElementActionButtons (duplicate/layer/delete)
// for a freeform element, or just DeleteFieldAction for a deletable template
// field (an item/bullet/stat — most template fields, like title, get no
// actions at all: there's nothing to duplicate or reorder about one).
function TextStyleToolbar({
  fontSize, color, bold, italic, align,
  onNudgeFontSize, onChangeFontSize, onBlurFontSize,
  onChangeColor, onToggleBold, onToggleItalic, onChangeAlign,
  disabled, actions, onDone,
}) {
  return (
    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 z-20 flex items-center gap-3 px-4 py-2 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onNudgeFontSize(-1)}
          disabled={disabled}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Decrease font size"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <input
          type="number"
          min={6}
          max={200}
          value={fontSize}
          onChange={(e) => onChangeFontSize(Number(e.target.value))}
          onBlur={onBlurFontSize}
          disabled={disabled}
          className="w-12 text-center rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 text-xs px-1 py-1 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => onNudgeFontSize(1)}
          disabled={disabled}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Increase font size"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <input
        type="color"
        value={`#${color}`}
        onChange={(e) => onChangeColor(e.target.value.replace('#', '').toUpperCase())}
        disabled={disabled}
        title="Text color"
        className="h-7 w-7 rounded border border-gray-300 dark:border-gray-700 cursor-pointer bg-transparent p-0 disabled:opacity-50 disabled:cursor-not-allowed"
      />

      <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

      <button
        type="button"
        onClick={onToggleBold}
        disabled={disabled}
        title="Bold"
        className={cn(
          'w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed',
          bold && 'bg-gray-200 dark:bg-gray-700'
        )}
      >
        <Bold className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={onToggleItalic}
        disabled={disabled}
        title="Italic"
        className={cn(
          'w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed',
          italic && 'bg-gray-200 dark:bg-gray-700'
        )}
      >
        <Italic className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

      <div className="flex items-center gap-0.5">
        {[
          { value: 'left', Icon: AlignLeft },
          { value: 'center', Icon: AlignCenter },
          { value: 'right', Icon: AlignRight },
        ].map(({ value, Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => onChangeAlign(value)}
            disabled={disabled}
            title={`Align ${value}`}
            className={cn(
              'w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed',
              align === value && 'bg-gray-200 dark:bg-gray-700'
            )}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>

      {actions}

      <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

      <button
        type="button"
        onClick={onDone}
        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
      >
        Done
      </button>
    </div>
  );
}

// Floating toolbar for a selected rect-shaped template field (TwoColumn's
// card, FeatureSplit's panel, StatCallout's per-stat card, Comparison's
// per-item card). Much smaller than TextStyleToolbar — there's no font/color
// to edit here, just a corner-radius slider (0 = sharp corners, matches the
// min a card can have; 0.4in reads as fully pill-shaped on every card size
// this app produces). Not shown for the timeline connector line, which has
// no radius concept — see Shape's handleClick in SlideRenderer.jsx, which
// only reports `{ kind: 'shape', radius }` fieldDefaults when the field
// actually has a `radius` prop.
function ShapeRadiusToolbar({ radius, onChangeRadius, onBlurRadius, disabled, actions, onDone }) {
  return (
    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 z-20 flex items-center gap-3 px-4 py-2 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <span className="text-[10px] text-gray-400 dark:text-gray-500">Corner radius</span>
      <input
        type="range"
        min={0}
        max={0.4}
        step={0.01}
        value={radius}
        onChange={(e) => onChangeRadius(Number(e.target.value))}
        onMouseUp={onBlurRadius}
        onTouchEnd={onBlurRadius}
        disabled={disabled}
        className="w-28 disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <span className="text-xs text-gray-500 dark:text-gray-400 w-10 text-right tabular-nums">{radius.toFixed(2)}"</span>

      {actions}

      <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

      <button
        type="button"
        onClick={onDone}
        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
      >
        Done
      </button>
    </div>
  );
}

// Floating toolbar for a selected slide.heroImage. Same small-toolbar shell
// as ShapeRadiusToolbar above, but with no style controls to edit — just
// Replace (opens the Uploads panel in hero-image-picker mode, see
// imagePickTarget below) or Remove entirely, since position/size/rotation
// are already handled by SlideRenderer's Moveable handles directly on the
// image, same as every other interactive field.
function HeroImageToolbar({ onReplace, onRemove, disabled, onDone }) {
  return (
    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 z-20 flex items-center gap-3 px-4 py-2 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <button
        type="button"
        onClick={onReplace}
        disabled={disabled}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:text-violet-600 dark:hover:text-violet-400 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Upload className="w-3.5 h-3.5" />
        Replace image
      </button>

      <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Remove image
      </button>

      <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

      <button
        type="button"
        onClick={onDone}
        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
      >
        Done
      </button>
    </div>
  );
}

async function postJson(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data.error || 'Request failed.' };
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message || 'Request failed.' };
  }
}

// Full-page preview + edit surface for one generated deck. Deliberately its
// own route (not a modal) so it never shows the app's navbar/sidebar chrome
// while editing — the only way out is the explicit Close button below.
//
// Ported from electron/slides/SlideDeckEditor.jsx — every `window.api.*` IPC
// call replaced with a `fetch()` against this port's API routes
// (src/app/api/slide-decks/[deckId]/...); everything else (selection state,
// undo/redo, keyboard shortcuts, drag/resize/rotate wiring) is unchanged,
// since none of it ever touched an Electron API.
export default function SlideDeckEditor({ deckId, onClose }) {
  const [deck, setDeck] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState('deck');
  const [instruction, setInstruction] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [lastInstruction, setLastInstruction] = useState(null);
  const [applyingPalette, setApplyingPalette] = useState(null);
  const [themeError, setThemeError] = useState(null);
  const [isReordering, setIsReordering] = useState(false);
  const [reorderError, setReorderError] = useState(null);
  const [savingBackground, setSavingBackground] = useState(false);
  // Left tool rail's flyout panel — one shared slot, not a boolean per tool,
  // since the 4 panels are flex siblings between the icon rail and the
  // canvas; more than one open at once would break the layout. null |
  // 'text' | 'shape' | 'uploads' | 'background'. Selecting the already-open
  // tool closes it; selecting a different one switches (closing whatever
  // was open) — see onSelectTool passed to LeftToolsPanel below.
  const [activeTool, setActiveTool] = useState(null);
  // Which slot the Uploads panel is currently picking an image FOR — null
  // (default) means "insert a new freeform image element" (handleAddImage);
  // 'heroImage' means the panel was opened via HeroImageToolbar's Replace
  // button, so picking a thumbnail instead replaces slide.heroImage
  // (handlePickHeroImage) and the panel closes itself. Reset to null
  // whenever the rail's own Uploads icon is used, so a plain open always
  // starts in ordinary insert mode.
  const [imagePickTarget, setImagePickTarget] = useState(null);
  // Multi-select — an array so shift-click and marquee-select (via
  // react-selecto, see the Selecto element below) can build up more than
  // one selected freeform element. Most existing single-element logic (the
  // style toolbars, Moveable drag/resize/rotate, delete/duplicate/
  // layering) still only cares about the solo case, so
  // `selectedElementId`/`setSelectedElementId` are kept as a thin
  // single-value view over the array.
  const [selectedElementIds, setSelectedElementIds] = useState([]);
  const selectedElementId = selectedElementIds.length === 1 ? selectedElementIds[0] : null;
  // Selecting a freeform element always clears any selected template field
  // (see selectedFieldPath below) — the two selection systems never both
  // show something selected at once.
  const setSelectedElementId = (id) => {
    setSelectedElementIds(id ? [id] : []);
    if (id) { setSelectedFieldPath(null); setEditingFieldPath(null); }
  };
  // Separate from selection — a text element can be selected (draggable)
  // without being in contentEditable edit mode; see SlideRenderer.jsx's
  // FreeformElement for why the two are split apart.
  const [editingElementId, setEditingElementId] = useState(null);
  // Selected/editing TEMPLATE content field (title/bullets/item labels/...),
  // analogous to selectedElementId/editingElementId above but for the
  // AI-generated content's own position overrides, not the freeform
  // elements[] overlay. A single fieldPath string (e.g. "title",
  // "bullets[0]"), not multi-select — template fields don't have
  // align/distribute or bulk actions.
  const [selectedFieldPath, setSelectedFieldPath] = useState(null);
  const [editingFieldPath, setEditingFieldPath] = useState(null);
  // The selected template field's inherent style (fontSize/color/bold/
  // italic/align) BEFORE any override — reported by SlideRenderer.jsx's
  // TextBox at the moment of selection (see handleSelectField below), since
  // template fields don't store their own style on the slide the way a
  // freeform element does; the floating text toolbar falls back to this for
  // whichever style field isn't already present in layoutOverrides.
  const [selectedFieldDefaults, setSelectedFieldDefaults] = useState(null);
  const [isPresenting, setIsPresenting] = useState(false);
  const [presentSize, setPresentSize] = useState({ width: 1280, height: 720 });
  const pollRef = useRef(null);
  const previewRef = useRef(null);
  // The slide-sized stage wrapper (not previewRef, which also includes the
  // gray padding around it) — react-selecto's marquee-select container, so a
  // drag gesture only starts a selection rectangle within the visible slide.
  // Selecto only reads `container` once, at mount, so this has to be state
  // (triggering a re-render once the DOM node exists) rather than a plain
  // ref — a ref's `.current` read during render would still be null on the
  // very first render, before React has committed the DOM and assigned it.
  const [stageEl, setStageEl] = useState(null);
  // Set for one tick right after a marquee-select lands a non-empty
  // selection, so the very next bubbled click on previewRef's
  // background-click-to-deselect handler doesn't immediately wipe it out.
  const suppressNextDeselectRef = useRef(false);
  // Session-local (in-memory, not persisted) undo/redo history for freeform
  // mutations — refs rather than state, since the stacks don't need to
  // trigger re-renders themselves. Each entry is a {slideIndex, elements,
  // backgroundColor} snapshot taken just before a mutation; see
  // pushUndoSnapshot/handleUndo/handleRedo below. Template content edits
  // (handleCommitField) go through a separate route (update-slide-content)
  // and are deliberately NOT covered — this is scoped to the freeform
  // override layer only.
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const lastUndoPushRef = useRef({ key: null, time: 0 });
  // In-memory clipboard for Ctrl/Cmd+C/V — holds full element data (no id,
  // reassigned fresh on paste) so paste can target a different slide than
  // the one it was copied from.
  const clipboardRef = useRef([]);
  const presentRef = useRef(null);
  const [previewWidth, setPreviewWidth] = useState(600);
  // Slightly under 1 by default so the toolbar/canvas don't feel cramped —
  // independent of the auto-fit-to-container base scale.
  const [zoom, setZoom] = useState(0.85);

  const fetchDeck = async () => {
    const res = await fetch(`/api/slide-decks/${deckId}`).then((r) => r.json()).catch(() => null);
    if (res?.deck) setDeck(res.deck);
    return res?.deck || null;
  };

  useEffect(() => {
    if (!deckId) return;
    fetchDeck();
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId]);

  useEffect(() => {
    clearInterval(pollRef.current);
    if (deck?.status === 'generating') {
      pollRef.current = setInterval(async () => {
        const updated = await fetchDeck();
        if (updated && updated.status !== 'generating') {
          setIsEditing(false);
          if (updated.errorMessage) setLastError(updated.errorMessage);
        }
      }, POLL_INTERVAL_MS);
    }
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck?.status]);

  useEffect(() => {
    if (!previewRef.current) return;
    const el = previewRef.current;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setPreviewWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [deck?.outlineJson]);

  // A selected freeform element (or template field) only ever belongs to
  // the slide it was selected on — switching slides must not leave the
  // inspector pointing at something on a different, now-hidden slide.
  useEffect(() => {
    setSelectedElementId(null);
    setEditingElementId(null);
    setSelectedFieldPath(null);
    setEditingFieldPath(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex]);

  const exitPresentation = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setIsPresenting(false);
  };

  // Requests real OS/browser fullscreen on the presentation overlay (not
  // just a CSS "fixed inset-0" look) and keeps isPresenting in sync if the
  // user exits fullscreen by any means the app didn't initiate (F11, the
  // browser's own Escape-exits-fullscreen behavior, etc.) — the effect
  // cleanup also exits fullscreen if this component unmounts mid-presentation.
  useEffect(() => {
    if (!isPresenting) return;
    const updateSize = () => setPresentSize({ width: window.innerWidth, height: window.innerHeight });
    updateSize();
    window.addEventListener('resize', updateSize);

    if (presentRef.current?.requestFullscreen) {
      presentRef.current.requestFullscreen().catch(() => {});
    }

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) setIsPresenting(false);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      window.removeEventListener('resize', updateSize);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [isPresenting]);

  // Arrow-key slide traversal — active whenever a deck with a live outline
  // is open. Skipped while focus is in an editable field (the instruction
  // textarea, a color input, etc.) so typing never gets hijacked into
  // changing the selected slide. In presentation mode Escape also exits
  // (backup for when true fullscreen wasn't granted — see effect above).
  useEffect(() => {
    const outline = deck?.outlineJson;
    if (!outline) return;

    const handleKeyDown = (e) => {
      if (isPresenting) {
        if (e.key === 'Escape') {
          e.preventDefault();
          exitPresentation();
          return;
        }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
          e.preventDefault();
          setSelectedIndex((i) => Math.min(outline.slides.length - 1, i + 1));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(0, i - 1));
        }
        return;
      }

      const active = document.activeElement;
      const isEditableFocus = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (isEditableFocus) return;
      // A selected freeform element steals plain arrow keys for nudging
      // instead (see the keyboard-shortcuts effect below) — slide traversal
      // only applies when nothing is selected.
      if (selectedElementIds.length > 0) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(outline.slides.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck?.outlineJson, isPresenting, selectedElementIds]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!instruction.trim() || isEditing || !!applyingPalette || isReordering || !deck?.outlineJson) return;
    setIsEditing(true);
    setLastError(null);
    const res = await postJson(`/api/slide-decks/${deckId}/edit`, {
      mode,
      slideIndex: mode === 'slide' ? selectedIndex : undefined,
      instruction: instruction.trim(),
    });
    if (!res?.success) {
      setIsEditing(false);
      setLastError(res?.error || 'Edit failed.');
      return;
    }
    setLastInstruction(instruction.trim());
    setInstruction('');
    await fetchDeck(); // picks up status: 'generating' immediately; poll takes over
  };

  const handleSelectPalette = async (paletteName) => {
    if (!deck?.outlineJson || applyingPalette || isEditing || isReordering || deck.status !== 'ready') return;
    if (paletteName === deck.outlineJson.paletteName && !deck.outlineJson.brandKit?.active) return;
    setApplyingPalette(paletteName);
    setThemeError(null);
    const res = await postJson(`/api/slide-decks/${deckId}/theme`, { paletteName });
    if (res?.success) {
      setDeck(res.deck);
    } else {
      setThemeError(res?.error || 'Could not apply that theme.');
    }
    setApplyingPalette(null);
  };

  const handleSelectBrandPalette = async () => {
    if (!deck?.outlineJson?.brandKit?.colors || applyingPalette || isEditing || isReordering || deck.status !== 'ready') return;
    if (deck.outlineJson.brandKit.active) return;
    setApplyingPalette('__brand__');
    setThemeError(null);
    const res = await postJson(`/api/slide-decks/${deckId}/theme`, { useBrand: true });
    if (res?.success) {
      setDeck(res.deck);
    } else {
      setThemeError(res?.error || 'Could not apply your brand colors.');
    }
    setApplyingPalette(null);
  };

  const reorderDisabled = isEditing || !!applyingPalette || isReordering || deck?.status !== 'ready';
  // Same disabling condition as reorderDisabled, named separately since it
  // guards a conceptually different surface (the left tools panel).
  const freeformDisabled = reorderDisabled;

  // Reads a {slideIndex, elements, backgroundColor} snapshot out of a given
  // deck value — used both to push an undo entry (from the CURRENT deck,
  // before a mutation) and to build a redo entry (from the current deck,
  // right before an undo overwrites it). Safe to store by reference: every
  // mutation in this file always produces brand-new element objects/arrays
  // rather than mutating existing ones in place, so an old array reference
  // stays valid forever.
  const snapshotFreeform = (deckValue, slideIndex) => ({
    slideIndex,
    elements: deckValue?.outlineJson?.slides[slideIndex]?.elements || [],
    backgroundColor: deckValue?.outlineJson?.slides[slideIndex]?.backgroundColor ?? null,
    layoutOverrides: deckValue?.outlineJson?.slides[slideIndex]?.layoutOverrides || {},
    heroImage: deckValue?.outlineJson?.slides[slideIndex]?.heroImage ?? null,
  });

  // Pushes the PRE-mutation freeform state onto the undo stack and clears
  // the redo stack (standard undo/redo semantics: a new action invalidates
  // any redo history). `coalesceKey`, when provided, merges rapid repeated
  // pushes with the same key inside UNDO_COALESCE_MS into a single entry —
  // for continuous inputs (a color-picker drag, digits typed into a size
  // field) so one logical edit doesn't become dozens of undo steps. Discrete
  // actions (add/delete/duplicate/align/a toggle-button click) pass no key,
  // so every call always pushes a fresh entry.
  const pushUndoSnapshot = (slideIndex, coalesceKey) => {
    if (!deck?.outlineJson) return;
    const now = Date.now();
    const last = lastUndoPushRef.current;
    if (coalesceKey && last.key === coalesceKey && now - last.time < UNDO_COALESCE_MS) {
      last.time = now;
      return;
    }
    lastUndoPushRef.current = { key: coalesceKey || null, time: now };
    undoStackRef.current.push(snapshotFreeform(deck, slideIndex));
    if (undoStackRef.current.length > UNDO_STACK_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
  };

  // Pushes a non-freeform (structural) undo entry — currently only
  // {type: 'delete-slide', slideIndex, slide}, from handleDeleteSlide above.
  // Always discrete (no coalescing — a slide deletion is never a rapid
  // repeated micro-edit the way a color-picker drag is), and always clears
  // redo, same as pushUndoSnapshot. handleUndo/handleRedo below check
  // `type` to tell a structural entry apart from a plain (untyped) freeform
  // one and replay it differently.
  const pushStructuralUndo = (entry) => {
    lastUndoPushRef.current = { key: null, time: Date.now() };
    undoStackRef.current.push(entry);
    if (undoStackRef.current.length > UNDO_STACK_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
  };

  // The one place every freeform (elements/backgroundColor) mutation in this
  // file ultimately persists through — applies the optimistic update
  // immediately, writes it via the layout-patch route, and rolls the local
  // state back on failure. Does NOT touch the undo stack itself (callers
  // call pushUndoSnapshot beforehand) so undo/redo replays (which must NOT
  // push a new undo entry for themselves) can reuse it too.
  const persistFreeform = async (slideIndex, patch) => {
    if (!deck?.outlineJson) return;
    const slides = deck.outlineJson.slides.map((s, i) => (i === slideIndex ? { ...s, ...patch } : s));
    const prevDeck = deck;
    setDeck({ ...deck, outlineJson: { ...deck.outlineJson, slides } });

    const res = await postJson(`/api/slide-decks/${deckId}/layout`, { slideIndex, ...patch });
    if (res?.success) {
      setDeck(res.deck);
    } else {
      setDeck(prevDeck);
    }
    return res;
  };

  // Mirrors handleReorder's optimistic-update-then-rollback shape (now via
  // persistFreeform). The native color picker fires onChange continuously
  // while dragging inside it, so background-color pushes coalesce.
  const handleSetBackground = async (backgroundColor) => {
    if (!deck?.outlineJson || freeformDisabled) return;
    pushUndoSnapshot(selectedIndex, `bg:${selectedIndex}`);
    setSavingBackground(true);
    await persistFreeform(selectedIndex, { backgroundColor });
    setSavingBackground(false);
  };

  // Inserts a new freeform element centered on the current slide and selects
  // it immediately so the toolbar shows up without a second click. Shared by
  // the Text tool and every Shape kind — `defaults` mirrors
  // src/lib/slides/elements.js's DEFAULT_ELEMENT_BY_KIND for the given kind.
  // Position is fixed at insert time; dragging, resizing, or rotating it
  // afterward goes through handleCommitElementTransform.
  const handleAddElement = async (kind, defaults) => {
    if (!deck?.outlineJson || freeformDisabled) return;
    pushUndoSnapshot(selectedIndex);
    const newElement = {
      id: crypto.randomUUID(),
      kind,
      x: (SLIDE_W - defaults.w) / 2, y: (SLIDE_H - defaults.h) / 2, rotation: 0, zIndex: 0,
      ...defaults,
    };
    const nextElements = [...(deck.outlineJson.slides[selectedIndex]?.elements || []), newElement];
    setSelectedElementId(newElement.id);

    const res = await persistFreeform(selectedIndex, { elements: nextElements });
    if (!res?.success) setSelectedElementId(null);
  };

  const handleAddText = (preset = 'default') => handleAddElement('text', TEXT_PRESET_DEFAULTS[preset] || TEXT_ELEMENT_DEFAULTS);
  const handleAddShape = (kind) => handleAddElement(kind, SHAPE_ELEMENT_DEFAULTS[kind]);

  // Inserts an image picked from the Uploads panel. Unlike TEXT/SHAPE
  // defaults (fixed constants), an image's insert box is computed per-image
  // from its actual pixel dimensions, capped at MAX_IMAGE_INSERT_DIM on the
  // long side so a huge photo doesn't dwarf the slide.
  const handleAddImage = (image) => {
    const MAX_IMAGE_INSERT_DIM = 4; // inches
    const aspect = image.width && image.height ? image.height / image.width : 0.75;
    let w = MAX_IMAGE_INSERT_DIM, h = MAX_IMAGE_INSERT_DIM * aspect;
    if (h > MAX_IMAGE_INSERT_DIM) { h = MAX_IMAGE_INSERT_DIM; w = MAX_IMAGE_INSERT_DIM / aspect; }
    handleAddElement('image', { w, h, src: image.url, opacity: 1 });
  };

  // Swaps the AI-generated slide.heroImage for one picked from the Uploads
  // panel (uploaded fresh, previously uploaded, or AI-generated — the panel
  // doesn't distinguish, see imagePickTarget above), keeping whatever
  // position/size/rotation override is already on it (a plain
  // layoutOverrides["heroImage"] entry from handleCommitFieldOverride,
  // untouched by this — only the src changes). Closes the panel on pick but
  // deliberately leaves selectedFieldPath alone, so HeroImageToolbar stays
  // open for another Replace or a Remove/Done.
  const handlePickHeroImage = async (image) => {
    if (!deck?.outlineJson || freeformDisabled) return;
    pushUndoSnapshot(selectedIndex);
    setActiveTool(null);
    setImagePickTarget(null);
    await persistFreeform(selectedIndex, { heroImage: { src: image.url } });
  };

  const handleRemoveHeroImage = async () => {
    if (!deck?.outlineJson || freeformDisabled) return;
    pushUndoSnapshot(selectedIndex);
    setSelectedFieldPath(null);
    setEditingFieldPath(null);
    setSelectedFieldDefaults(null);
    await persistFreeform(selectedIndex, { heroImage: null });
  };

  // A text element must be selected before it can be entered into edit mode
  // (see SlideRenderer.jsx's FreeformElement) — ensure both in one call so
  // a double-click on a not-yet-selected element still works in one step.
  const handleStartEditingElement = (elementId) => {
    setSelectedElementId(elementId);
    setEditingElementId(elementId);
  };

  // Shift-click toggles one element into/out of the current multi-selection
  // — a plain click (handled by setSelectedElementId via onSelect) always
  // collapses to just that one element instead.
  const handleToggleSelectElement = (elementId) => {
    setSelectedElementIds((prev) => (prev.includes(elementId) ? prev.filter((id) => id !== elementId) : [...prev, elementId]));
    setEditingElementId(null);
    setSelectedFieldPath(null);
    setEditingFieldPath(null);
  };

  // The single mutation point for editing an existing freeform element.
  // Computes the next elements array directly from the current `deck`
  // closure (never reads state back after setDeck, which would be stale
  // until the next render) so the optimistic update and the persisted patch
  // are always in sync. `persist: false` is used for per-keystroke typing —
  // callers flush via persistCurrentElements on blur instead of writing to
  // the server (and rebuilding the .pptx) on every character.
  //
  // Undo: every call pushes a snapshot first. `persist: true` calls default
  // to NO coalescing (a discrete action like a bold-toggle click or a
  // drag/resize/rotate-end always gets its own undo entry) unless the
  // caller passes an explicit `coalesceKey` (the color pickers do, since
  // they fire onChange continuously while dragging). `persist: false` calls
  // (keystroke-driven, flushed later via persistCurrentElements) default to
  // coalescing per element+field, since a burst of keystrokes for one typed
  // value should undo as one step, not one per keystroke.
  const applyElementPatch = (elementId, patch, { persist = false, coalesceKey } = {}) => {
    if (!deck?.outlineJson) return;
    const effectiveKey = coalesceKey ?? (persist ? undefined : `local:${elementId}:${Object.keys(patch).sort().join(',')}`);
    pushUndoSnapshot(selectedIndex, effectiveKey);
    const currentElements = deck.outlineJson.slides[selectedIndex]?.elements || [];
    const nextElements = currentElements.map((el) => (el.id === elementId ? { ...el, ...patch } : el));
    if (persist) {
      persistFreeform(selectedIndex, { elements: nextElements });
    } else {
      const slides = deck.outlineJson.slides.map((s, i) => (i === selectedIndex ? { ...s, elements: nextElements } : s));
      setDeck({ ...deck, outlineJson: { ...deck.outlineJson, slides } });
    }
  };

  // Commits a drag/resize/rotate's final transform — react-moveable in
  // SlideRenderer.jsx only calls this once per gesture, on drag/resize/
  // rotate-end, never per-frame during the gesture itself. `patch` is
  // whichever subset of {x, y, w, h, rotation} that gesture produced.
  const handleCommitElementTransform = (elementId, patch) => {
    applyElementPatch(elementId, patch, { persist: true });
  };

  // Flushes whatever is currently in local state for the selected slide's
  // elements — used on blur after a run of local-only (persist: false)
  // keystroke edits from applyElementPatch. No undo push here: the
  // triggering applyElementPatch call(s) already pushed one (coalesced) for
  // this whole edit session.
  const persistCurrentElements = async () => {
    if (!deck?.outlineJson) return;
    const elements = deck.outlineJson.slides[selectedIndex]?.elements || [];
    await persistFreeform(selectedIndex, { elements });
  };

  // Template-field counterpart of persistCurrentElements — flushes whatever
  // non-persisted layoutOverrides edits are currently sitting in local state
  // (e.g. from typing into the text toolbar's font-size box) once the user
  // blurs the field, same debounce-then-flush pattern.
  const persistCurrentFieldOverrides = async () => {
    if (!deck?.outlineJson) return;
    const layoutOverrides = deck.outlineJson.slides[selectedIndex]?.layoutOverrides || {};
    await persistFreeform(selectedIndex, { layoutOverrides });
  };

  // Removes every currently selected freeform element (one or many — the
  // Delete key does the expected thing on a multi-selection too).
  const handleDeleteElement = async () => {
    if (!deck?.outlineJson || freeformDisabled || selectedElementIds.length === 0) return;
    pushUndoSnapshot(selectedIndex);
    const idsToDelete = new Set(selectedElementIds);
    const nextElements = (deck.outlineJson.slides[selectedIndex]?.elements || []).filter((el) => !idsToDelete.has(el.id));
    const prevSelectedElementIds = selectedElementIds;
    setSelectedElementIds([]);

    const res = await persistFreeform(selectedIndex, { elements: nextElements });
    if (!res?.success) setSelectedElementIds(prevSelectedElementIds);
  };

  // Clones every currently selected element (one or many, building on
  // multi-select) with a small offset so the copies are visibly distinct
  // from their originals, placed above them in stacking order, and
  // immediately selected in place of the originals.
  const handleDuplicateElement = async () => {
    if (!deck?.outlineJson || freeformDisabled || selectedElementIds.length === 0) return;
    pushUndoSnapshot(selectedIndex);
    const siblings = deck.outlineJson.slides[selectedIndex]?.elements || [];
    const toClone = siblings.filter((el) => selectedElementIds.includes(el.id));
    const clones = cloneElementsWithOffset(toClone, 0.3, siblings.length);
    const nextElements = [...siblings, ...clones];
    const prevSelectedElementIds = selectedElementIds;
    setSelectedElementIds(clones.map((c) => c.id));

    const res = await persistFreeform(selectedIndex, { elements: nextElements });
    if (!res?.success) setSelectedElementIds(prevSelectedElementIds);
  };

  // Moves the selected element one step up/down in stacking order by
  // swapping it with its neighbor in zIndex-sorted order, then reassigns
  // sequential zIndex values (0..n-1) to the whole list — keeps zIndex clean
  // and gap-free rather than drifting after repeated reorders.
  const handleReorderLayer = async (direction) => {
    if (!deck?.outlineJson || freeformDisabled || !selectedElement) return;
    const elements = deck.outlineJson.slides[selectedIndex]?.elements || [];
    const sorted = [...elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    const idx = sorted.findIndex((el) => el.id === selectedElement.id);
    const swapIdx = direction === 'forward' ? idx + 1 : idx - 1;
    if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return;
    pushUndoSnapshot(selectedIndex);
    [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
    const nextElements = sorted.map((el, i) => ({ ...el, zIndex: i }));
    await persistFreeform(selectedIndex, { elements: nextElements });
  };

  // Aligns or evenly distributes every currently multi-selected freeform
  // element. Align actions need >= 2 selected; distribute needs >= 3 (with
  // 2, "even spacing" is meaningless — there's only one gap). Distribute
  // equalizes the empty space between elements' bounding-box edges (the
  // standard Figma/Canva "distribute spacing" behavior), not their
  // left/top edges.
  const handleAlignDistribute = async (action) => {
    if (!deck?.outlineJson || freeformDisabled || selectedElementIds.length < 2) return;
    const elements = deck.outlineJson.slides[selectedIndex]?.elements || [];
    const selectedEls = elements.filter((el) => selectedElementIds.includes(el.id));
    if (selectedEls.length < 2) return;

    const patches = new Map();
    switch (action) {
      case 'left': {
        const minX = Math.min(...selectedEls.map((el) => el.x));
        selectedEls.forEach((el) => patches.set(el.id, { x: minX }));
        break;
      }
      case 'right': {
        const maxRight = Math.max(...selectedEls.map((el) => el.x + el.w));
        selectedEls.forEach((el) => patches.set(el.id, { x: maxRight - el.w }));
        break;
      }
      case 'hcenter': {
        const left = Math.min(...selectedEls.map((el) => el.x));
        const right = Math.max(...selectedEls.map((el) => el.x + el.w));
        const centerX = (left + right) / 2;
        selectedEls.forEach((el) => patches.set(el.id, { x: centerX - el.w / 2 }));
        break;
      }
      case 'top': {
        const minY = Math.min(...selectedEls.map((el) => el.y));
        selectedEls.forEach((el) => patches.set(el.id, { y: minY }));
        break;
      }
      case 'bottom': {
        const maxBottom = Math.max(...selectedEls.map((el) => el.y + el.h));
        selectedEls.forEach((el) => patches.set(el.id, { y: maxBottom - el.h }));
        break;
      }
      case 'vmiddle': {
        const top = Math.min(...selectedEls.map((el) => el.y));
        const bottom = Math.max(...selectedEls.map((el) => el.y + el.h));
        const centerY = (top + bottom) / 2;
        selectedEls.forEach((el) => patches.set(el.id, { y: centerY - el.h / 2 }));
        break;
      }
      case 'distributeH': {
        if (selectedEls.length < 3) return;
        const sorted = [...selectedEls].sort((a, b) => a.x - b.x);
        const left = sorted[0].x;
        const right = sorted[sorted.length - 1].x + sorted[sorted.length - 1].w;
        const totalW = sorted.reduce((sum, el) => sum + el.w, 0);
        const gap = (right - left - totalW) / (sorted.length - 1);
        let cursor = left;
        sorted.forEach((el) => { patches.set(el.id, { x: cursor }); cursor += el.w + gap; });
        break;
      }
      case 'distributeV': {
        if (selectedEls.length < 3) return;
        const sorted = [...selectedEls].sort((a, b) => a.y - b.y);
        const top = sorted[0].y;
        const bottom = sorted[sorted.length - 1].y + sorted[sorted.length - 1].h;
        const totalH = sorted.reduce((sum, el) => sum + el.h, 0);
        const gap = (bottom - top - totalH) / (sorted.length - 1);
        let cursor = top;
        sorted.forEach((el) => { patches.set(el.id, { y: cursor }); cursor += el.h + gap; });
        break;
      }
      default:
        return;
    }

    pushUndoSnapshot(selectedIndex);
    const nextElements = elements.map((el) => (patches.has(el.id) ? { ...el, ...patches.get(el.id) } : el));
    await persistFreeform(selectedIndex, { elements: nextElements });
  };

  // Ctrl/Cmd+C — snapshots the currently selected elements' full data into
  // an in-memory clipboard. Session-local only (a ref, not persisted) —
  // closing the tab loses it, same as a real OS clipboard would between app
  // restarts being out of scope here.
  const handleCopySelected = () => {
    if (!deck?.outlineJson || selectedElementIds.length === 0) return;
    const elements = deck.outlineJson.slides[selectedIndex]?.elements || [];
    clipboardRef.current = elements.filter((el) => selectedElementIds.includes(el.id)).map((el) => ({ ...el }));
  };

  // Ctrl/Cmd+V — pastes the clipboard onto the CURRENT slide (which may be a
  // different slide than the one it was copied from — same as copy-paste
  // between slides in Canva/PowerPoint), offset and selected the same way a
  // duplicate is.
  const handlePasteClipboard = async () => {
    if (!deck?.outlineJson || freeformDisabled || clipboardRef.current.length === 0) return;
    pushUndoSnapshot(selectedIndex);
    const siblings = deck.outlineJson.slides[selectedIndex]?.elements || [];
    const pasted = cloneElementsWithOffset(clipboardRef.current, 0.3, siblings.length);
    const nextElements = [...siblings, ...pasted];
    setSelectedElementIds(pasted.map((p) => p.id));
    setEditingElementId(null);
    await persistFreeform(selectedIndex, { elements: nextElements });
  };

  // Arrow-key nudge (Shift for a larger step) — moves every selected
  // element by the same delta, clamped to stay within the slide. Coalesced
  // by selection so holding an arrow key down (OS key-repeat fires many
  // keydowns) produces one undo entry per nudge "session," not one per
  // repeat tick.
  const handleNudgeSelected = (dx, dy) => {
    if (!deck?.outlineJson || freeformDisabled || selectedElementIds.length === 0) return;
    pushUndoSnapshot(selectedIndex, `nudge:${selectedElementIds.join(',')}`);
    const idSet = new Set(selectedElementIds);
    const elements = deck.outlineJson.slides[selectedIndex]?.elements || [];
    const nextElements = elements.map((el) => (idSet.has(el.id)
      ? { ...el, x: Math.min(SLIDE_W - el.w, Math.max(0, el.x + dx)), y: Math.min(SLIDE_H - el.h, Math.max(0, el.y + dy)) }
      : el));
    persistFreeform(selectedIndex, { elements: nextElements });
  };

  // Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z — session-local, in-memory undo/redo over
  // every freeform (elements/backgroundColor) mutation. Pops one history
  // entry, pushes the state it's about to overwrite onto the OTHER stack
  // (so redo can walk forward again after an undo, and vice versa), then
  // persists the restored snapshot exactly like any other freeform
  // mutation. Deliberately does not cover template content edits
  // (handleCommitField) or AI/theme edits — see the refs' declaration
  // comment for why.
  const handleUndo = async () => {
    if (!deck?.outlineJson || freeformDisabled || undoStackRef.current.length === 0) return;
    const snapshot = undoStackRef.current.pop();
    setSelectedElementIds([]);
    setEditingElementId(null);
    setSelectedFieldPath(null);
    setEditingFieldPath(null);

    // Structural entry (currently only delete-slide) — reverse it via its
    // own route instead of persistFreeform's per-slide patch, which has no
    // way to add a slide back into the array. On success, the SAME entry
    // moves onto the redo stack: redoing it means deleting this slide again.
    if (snapshot.type === 'delete-slide') {
      const res = await postJson(`/api/slide-decks/${deckId}/restore-slide`, { slideIndex: snapshot.slideIndex, slide: snapshot.slide });
      if (res?.success) {
        setDeck(res.deck);
        setSelectedIndex(snapshot.slideIndex);
        redoStackRef.current.push(snapshot);
      } else {
        undoStackRef.current.push(snapshot); // restore failed — put it back so undo can be retried
        setReorderError(res?.error || 'Could not restore that slide.');
      }
      return;
    }

    redoStackRef.current.push(snapshotFreeform(deck, snapshot.slideIndex));
    if (snapshot.slideIndex !== selectedIndex) setSelectedIndex(snapshot.slideIndex);
    await persistFreeform(snapshot.slideIndex, { elements: snapshot.elements, backgroundColor: snapshot.backgroundColor, layoutOverrides: snapshot.layoutOverrides, heroImage: snapshot.heroImage });
  };

  const handleRedo = async () => {
    if (!deck?.outlineJson || freeformDisabled || redoStackRef.current.length === 0) return;
    const snapshot = redoStackRef.current.pop();
    setSelectedElementIds([]);
    setEditingElementId(null);
    setSelectedFieldPath(null);
    setEditingFieldPath(null);

    if (snapshot.type === 'delete-slide') {
      const res = await postJson(`/api/slide-decks/${deckId}/delete-slide`, { slideIndex: snapshot.slideIndex });
      if (res?.success) {
        setDeck(res.deck);
        setSelectedIndex((i) => Math.min(i, res.deck.outlineJson.slides.length - 1));
        undoStackRef.current.push(snapshot);
      } else {
        redoStackRef.current.push(snapshot); // re-delete failed — put it back so redo can be retried
        setReorderError(res?.error || 'Could not redo that deletion.');
      }
      return;
    }

    undoStackRef.current.push(snapshotFreeform(deck, snapshot.slideIndex));
    if (snapshot.slideIndex !== selectedIndex) setSelectedIndex(snapshot.slideIndex);
    await persistFreeform(snapshot.slideIndex, { elements: snapshot.elements, backgroundColor: snapshot.backgroundColor, layoutOverrides: snapshot.layoutOverrides, heroImage: snapshot.heroImage });
  };

  // Commits a direct edit to one of the slide's OWN template content fields
  // (title, a bullet, an item's label, ...) — clicking straight into the
  // slide's rendered text and typing (see SlideRenderer's per-type
  // components, which build these fieldPaths). Separate from the freeform
  // elements above: this goes through the content-patch route, not the
  // layout-patch route, since it's editing content the AI normally owns,
  // not the freeform overlay.
  const handleCommitField = async (fieldPath, value) => {
    if (!deck?.outlineJson || freeformDisabled) return;
    const slide = deck.outlineJson.slides[selectedIndex];
    const nextSlide = setDeepValue(slide, fieldPath, value);
    const slides = deck.outlineJson.slides.map((s, i) => (i === selectedIndex ? nextSlide : s));
    const prevDeck = deck;
    setDeck({ ...deck, outlineJson: { ...deck.outlineJson, slides } });

    const topLevelKey = parsePathTokens(fieldPath)[0];
    const res = await postJson(`/api/slide-decks/${deckId}/content`, { slideIndex: selectedIndex, patch: { [topLevelKey]: nextSlide[topLevelKey] } });
    if (res?.success) {
      setDeck(res.deck);
    } else {
      setDeck(prevDeck);
    }
  };

  // Removes the whole generated-content item the CURRENTLY selected template
  // field belongs to (an icon_list/icon_grid/timeline/comparison/
  // process_steps item, a bullet, a stat, or a table row) — the AI-generated
  // counterpart to handleDeleteElement above for freeform elements. Only
  // acts when selectedFieldPath actually addresses one of those (see
  // parseDeletableFieldPath); a scalar field like title has nothing to
  // "delete" and is a no-op. Two sequential writes, since content
  // (items/bullets/stats/table) and layoutOverrides are deliberately
  // separate API routes (see handleCommitField/persistFreeform above) — the
  // second is skipped entirely when nothing under the deleted item actually
  // had an override, the common case.
  const handleDeleteField = async () => {
    if (!deck?.outlineJson || freeformDisabled) return;
    const parsed = parseDeletableFieldPath(selectedFieldPath);
    if (!parsed) return;
    const slide = deck.outlineJson.slides[selectedIndex];
    const prevOverrides = slide.layoutOverrides || {};

    // Guards run BEFORE touching selection state — bailing out here must
    // leave the field selected (and the delete toolbar button visible) so
    // the user gets to see why nothing happened, not just watch their
    // selection silently vanish.
    if (parsed.kind === 'table-row') {
      const table = slide.table;
      if (!table || !Array.isArray(table.rows) || table.rows.length <= 1) return;
    } else {
      const arr = Array.isArray(slide[parsed.field]) ? slide[parsed.field] : [];
      if (parsed.index < 0 || parsed.index >= arr.length) return;
    }

    setSelectedFieldPath(null);
    setEditingFieldPath(null);
    setSelectedFieldDefaults(null);

    if (parsed.kind === 'table-row') {
      const table = slide.table;
      const rows = table.rows.filter((_, i) => i !== parsed.index);
      const nextOverrides = remapOverridesAfterArrayDelete(prevOverrides, 'table.rows', parsed.index);
      await handleCommitField('table', { ...table, rows });
      if (JSON.stringify(nextOverrides) !== JSON.stringify(prevOverrides)) {
        await persistFreeform(selectedIndex, { layoutOverrides: nextOverrides });
      }
      return;
    }

    const arr = slide[parsed.field];
    const nextArr = arr.filter((_, i) => i !== parsed.index);
    const nextOverrides = remapOverridesAfterArrayDelete(prevOverrides, parsed.field, parsed.index);
    await handleCommitField(parsed.field, nextArr);
    if (JSON.stringify(nextOverrides) !== JSON.stringify(prevOverrides)) {
      await persistFreeform(selectedIndex, { layoutOverrides: nextOverrides });
    }
  };

  // A template field must be selected before it can be entered into edit
  // mode (see SlideRenderer.jsx's TextBox) — ensure both in one call so a
  // double-click on a not-yet-selected field still works in one step.
  // Selecting a field always clears any freeform element selection — the
  // two selection systems never both show something selected at once.
  // `fieldDefaults` (fontSize/color/bold/italic/align, reported by TextBox
  // at the moment of the click) feeds the floating text toolbar below, same
  // as it does for freeform elements.
  const handleSelectField = (fieldPath, fieldDefaults) => {
    setSelectedFieldPath(fieldPath);
    setSelectedFieldDefaults(fieldDefaults || null);
    setSelectedElementIds([]);
    setEditingElementId(null);
  };

  const handleStartEditingField = (fieldPath, fieldDefaults) => {
    setSelectedFieldPath(fieldPath);
    setEditingFieldPath(fieldPath);
    setSelectedFieldDefaults(fieldDefaults || null);
    setSelectedElementIds([]);
    setEditingElementId(null);
  };

  // Commits any change to a template content field's layoutOverrides entry —
  // a drag/resize/rotate transform ({x, y, w, h, rotation}) OR a style edit
  // from the floating text toolbar ({fontSize, color, bold, italic, align})
  // — an independent override layer on top of the AI-generated content, same
  // treatment as elements/backgroundColor, so it goes through the same
  // layout-patch route (via persistFreeform) as those, NOT the content-patch
  // route (which owns the field's actual text). `patch` is merged onto the
  // field's EXISTING override entry (not replaced wholesale), so e.g. a
  // resize doesn't clobber a previously-set color, and vice versa.
  const handleCommitFieldOverride = (fieldPath, patch, { persist = true, coalesceKey } = {}) => {
    if (!deck?.outlineJson || freeformDisabled) return;
    // Same auto-coalescing as applyElementPatch: a rapid burst of
    // non-persisted keystrokes (e.g. typing into the font-size box) shares
    // one undo entry instead of one per keystroke.
    const effectiveKey = coalesceKey ?? (persist ? undefined : `local:${fieldPath}:${Object.keys(patch).sort().join(',')}`);
    pushUndoSnapshot(selectedIndex, effectiveKey);
    const currentOverrides = deck.outlineJson.slides[selectedIndex]?.layoutOverrides || {};
    const nextOverrides = {
      ...currentOverrides,
      [fieldPath]: { ...currentOverrides[fieldPath], ...patch },
    };
    if (persist) {
      persistFreeform(selectedIndex, { layoutOverrides: nextOverrides });
    } else {
      const slides = deck.outlineJson.slides.map((s, i) => (i === selectedIndex ? { ...s, layoutOverrides: nextOverrides } : s));
      setDeck({ ...deck, outlineJson: { ...deck.outlineJson, slides } });
    }
  };

  const handleReorder = async (fromIndex, toIndex) => {
    if (!deck?.outlineJson || reorderDisabled) return;
    const prevDeck = deck;
    const prevSelectedIndex = selectedIndex;

    const slides = [...deck.outlineJson.slides];
    const [moved] = slides.splice(fromIndex, 1);
    slides.splice(toIndex, 0, moved);
    setDeck({ ...deck, outlineJson: { ...deck.outlineJson, slides } });
    setSelectedIndex((i) => indexAfterMove(i, fromIndex, toIndex));
    setIsReordering(true);
    setReorderError(null);

    const res = await postJson(`/api/slide-decks/${deckId}/reorder`, { fromIndex, toIndex });
    if (res?.success) {
      setDeck(res.deck);
    } else {
      setDeck(prevDeck);
      setSelectedIndex(prevSelectedIndex);
      setReorderError(res?.error || 'Could not reorder that slide.');
    }
    setIsReordering(false);
  };

  // Same optimistic-then-reconcile shape as handleReorder, and reuses its
  // isReordering/reorderError state — a duplicate is a structural edit the
  // same as a reorder, not its own busy-state pair.
  const handleDuplicate = async (index) => {
    if (!deck?.outlineJson || reorderDisabled) return;
    const prevDeck = deck;

    const slides = [...deck.outlineJson.slides];
    slides.splice(index + 1, 0, { ...slides[index] });
    setDeck({ ...deck, outlineJson: { ...deck.outlineJson, slides } });
    setSelectedIndex(index + 1);
    setIsReordering(true);
    setReorderError(null);

    const res = await postJson(`/api/slide-decks/${deckId}/duplicate-slide`, { slideIndex: index });
    if (res?.success) {
      setDeck(res.deck);
      // The route always inserts the duplicate directly after `slideIndex`.
      setSelectedIndex(index + 1);
    } else {
      setDeck(prevDeck);
      setSelectedIndex(index);
      setReorderError(res?.error || 'Could not duplicate that slide.');
    }
    setIsReordering(false);
  };

  // Same optimistic-then-reconcile shape as handleReorder/handleDuplicate,
  // plus: on success, pushes a {type: 'delete-slide'} entry onto the SAME
  // undo stack the freeform undo/redo above already uses (see
  // pushStructuralUndo/handleUndo/handleRedo below) so Ctrl/Cmd+Z revives
  // the deleted slide — the removed slide's full JSON comes back from the
  // route response itself, so undo can restore it byte-for-byte without
  // re-fetching. Refuses to remove a deck's last remaining slide.
  const handleDeleteSlide = async (index) => {
    if (!deck?.outlineJson || reorderDisabled) return;
    if (deck.outlineJson.slides.length <= 1) {
      setReorderError('A deck needs at least one slide.');
      return;
    }
    const prevDeck = deck;
    const prevSelectedIndex = selectedIndex;

    const slides = deck.outlineJson.slides.filter((_, i) => i !== index);
    setDeck({ ...deck, outlineJson: { ...deck.outlineJson, slides } });
    setSelectedIndex((i) => Math.min(i < index ? i : Math.max(0, i - 1), slides.length - 1));
    setIsReordering(true);
    setReorderError(null);

    const res = await postJson(`/api/slide-decks/${deckId}/delete-slide`, { slideIndex: index });
    if (res?.success) {
      setDeck(res.deck);
      pushStructuralUndo({ type: 'delete-slide', slideIndex: index, slide: res.removedSlide });
    } else {
      setDeck(prevDeck);
      setSelectedIndex(prevSelectedIndex);
      setReorderError(res?.error || 'Could not delete that slide.');
    }
    setIsReordering(false);
  };

  // Delete/Backspace removes every selected freeform element (one or many),
  // OR — when a deletable generated-content field is selected instead (an
  // item/bullet/stat/table row, see parseDeletableFieldPath) — that whole
  // item. Skipped while focus is in an editable field: this correctly leaves
  // Delete/Backspace alone while actually TYPING inside a template field
  // too, since editingFieldPath puts the same underlying node into
  // contentEditable the isEditableFocus check already catches. And while
  // presenting.
  useEffect(() => {
    const deletableField = parseDeletableFieldPath(selectedFieldPath);
    if ((selectedElementIds.length === 0 && !deletableField) || isPresenting) return;
    const handleKeyDown = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const active = document.activeElement;
      const isEditableFocus = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (isEditableFocus) return;
      e.preventDefault();
      if (selectedElementIds.length > 0) handleDeleteElement();
      else handleDeleteField();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElementIds, selectedFieldPath, isPresenting]);

  // Freeform keyboard shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo,
  // Ctrl/Cmd+D duplicate, Ctrl/Cmd+C/V copy-paste, and arrow-key nudge
  // (Shift for a bigger step) while something is selected. Skipped while
  // focus is in an editable field, so native browser undo/copy/paste inside
  // a text box or the AI instruction textarea is never hijacked, and while
  // presenting. A separate effect above already carves the plain-arrow-key
  // case out of slide traversal when there's a selection — this is where
  // that case is actually handled.
  useEffect(() => {
    if (!deck?.outlineJson || isPresenting) return;
    const handleKeyDown = (e) => {
      const active = document.activeElement;
      const isEditableFocus = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (isEditableFocus) return;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        if (selectedElementIds.length === 0) return;
        e.preventDefault();
        handleDuplicateElement();
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        if (selectedElementIds.length === 0) return;
        e.preventDefault();
        handleCopySelected();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        if (clipboardRef.current.length === 0) return;
        e.preventDefault();
        handlePasteClipboard();
        return;
      }
      if (selectedElementIds.length > 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        handleNudgeSelected(dx, dy);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck?.outlineJson, isPresenting, selectedElementIds, selectedIndex]);

  if (!deckId) return null;

  const outline = deck?.outlineJson;
  const activeBrandKit = outline?.brandKit?.active ? outline.brandKit : null;
  const theme = outline ? resolveTheme(outline.paletteName, outline.fontPairName, activeBrandKit?.colors) : null;
  // Mirrors src/lib/slides/buildDeck.js's own unconditional assignment —
  // without this, the live preview's theme object never carried
  // presentationType, so SlideRenderer.jsx's getStyle() could never resolve
  // anything but the plain default, even for a pitch-deck/sales deck whose
  // exported .pptx renders with real bold/warm card chrome.
  if (theme) theme.presentationType = outline.presentationType || null;
  if (theme && activeBrandKit?.logoPath) {
    theme.logo = { url: activeBrandKit.logoPath, width: activeBrandKit.logoWidth, height: activeBrandKit.logoHeight };
  }
  const selectedElement = outline?.slides[selectedIndex]?.elements?.find((el) => el.id === selectedElementId) || null;
  const mainScale = (Math.max(1, previewWidth - 32) / 13.3) * zoom; // 13.3in slide width, minus a little padding, times manual zoom
  // How many slides carry freeform overrides (elements and/or a custom
  // background) — purely informational for the whole-deck AI-edit guardrail
  // banner below; every AI edit's mergeFreeform step already guarantees
  // these survive regardless of this count.
  const manualEditSlideCount = outline?.slides.filter((s) => (s.elements && s.elements.length > 0) || s.backgroundColor).length || 0;

  const nudgeSelectedFontSize = (delta) => {
    if (!selectedElement) return;
    const next = Math.max(6, Math.min(200, selectedElement.fontSize + delta));
    applyElementPatch(selectedElement.id, { fontSize: next }, { persist: true });
  };
  // Fit-within (not fill) the viewport on both axes, since the screen's
  // aspect ratio rarely matches the slide's 13.3:7.5 exactly — letterboxed
  // on the black backdrop rather than cropped or distorted.
  const presentScale = Math.min(presentSize.width / 13.3, presentSize.height / 7.5);

  return (
    <>
      <div className="h-screen w-full flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
        {/* Header — `relative` so the floating text toolbar below can anchor
            to its bottom edge via `absolute top-full` without taking up any
            layout space of its own (it must overlay the canvas, never push
            it down). */}
        <div className="relative shrink-0">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                className="text-xs h-8 shrink-0"
                title="Close and go back"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                Close
              </Button>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-2">
                <Presentation className="h-4 w-4 text-primary-600 dark:text-primary-400 shrink-0" />
                {deck?.title || 'Slide Deck'}
              </h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {deck?.outlineJson && (
                <Button variant="outline" size="sm" onClick={() => setIsPresenting(true)} className="text-xs h-8">
                  <Play className="w-3.5 h-3.5 mr-1.5" />
                  Present
                </Button>
              )}
            </div>
          </div>

          {/* Floating Canva-style text toolbar — pops up independently
              centered just below the header, never shifts the canvas/body
              layout (positioned absolute relative to this `relative` header
              wrapper, so it overlays the canvas instead of pushing it down).
              Shared TextStyleToolbar so freeform text and template content
              fields (title/bullets/etc.) edit identically — the only
              difference is where the patch is written and that template
              fields don't get duplicate/layer/delete. */}
          {selectedElement && selectedElement.kind === 'text' && (
            <TextStyleToolbar
              fontSize={selectedElement.fontSize}
              color={selectedElement.color}
              bold={selectedElement.bold}
              italic={selectedElement.italic}
              align={selectedElement.align}
              onNudgeFontSize={nudgeSelectedFontSize}
              onChangeFontSize={(next) => applyElementPatch(selectedElement.id, { fontSize: next })}
              onBlurFontSize={persistCurrentElements}
              onChangeColor={(hexColor) => applyElementPatch(selectedElement.id, { color: hexColor }, { persist: true, coalesceKey: `color:${selectedElement.id}` })}
              onToggleBold={() => applyElementPatch(selectedElement.id, { bold: !selectedElement.bold }, { persist: true })}
              onToggleItalic={() => applyElementPatch(selectedElement.id, { italic: !selectedElement.italic }, { persist: true })}
              onChangeAlign={(value) => applyElementPatch(selectedElement.id, { align: value }, { persist: true })}
              disabled={freeformDisabled}
              actions={(
                <ElementActionButtons
                  onDuplicate={handleDuplicateElement}
                  onReorderLayer={handleReorderLayer}
                  onDelete={handleDeleteElement}
                  disabled={freeformDisabled}
                />
              )}
              onDone={() => { setSelectedElementId(null); setEditingElementId(null); }}
            />
          )}

          {selectedFieldPath && selectedFieldDefaults?.kind === 'text' && (() => {
            const fieldOverride = deck?.outlineJson?.slides[selectedIndex]?.layoutOverrides?.[selectedFieldPath] || {};
            const fieldStyle = {
              fontSize: fieldOverride.fontSize ?? selectedFieldDefaults.fontSize,
              color: fieldOverride.color ?? selectedFieldDefaults.color,
              bold: fieldOverride.bold ?? selectedFieldDefaults.bold,
              italic: fieldOverride.italic ?? selectedFieldDefaults.italic,
              align: fieldOverride.align ?? selectedFieldDefaults.align,
            };
            const nudgeFieldFontSize = (delta) => {
              const next = Math.max(6, Math.min(200, fieldStyle.fontSize + delta));
              handleCommitFieldOverride(selectedFieldPath, { fontSize: next });
            };
            return (
              <TextStyleToolbar
                {...fieldStyle}
                onNudgeFontSize={nudgeFieldFontSize}
                onChangeFontSize={(next) => handleCommitFieldOverride(selectedFieldPath, { fontSize: next }, { persist: false })}
                onBlurFontSize={persistCurrentFieldOverrides}
                onChangeColor={(hexColor) => handleCommitFieldOverride(selectedFieldPath, { color: hexColor }, { coalesceKey: `color:${selectedFieldPath}` })}
                onToggleBold={() => handleCommitFieldOverride(selectedFieldPath, { bold: !fieldStyle.bold })}
                onToggleItalic={() => handleCommitFieldOverride(selectedFieldPath, { italic: !fieldStyle.italic })}
                onChangeAlign={(value) => handleCommitFieldOverride(selectedFieldPath, { align: value })}
                disabled={freeformDisabled}
                actions={parseDeletableFieldPath(selectedFieldPath) && (
                  <DeleteFieldAction onClick={handleDeleteField} disabled={freeformDisabled} />
                )}
                onDone={() => { setSelectedFieldPath(null); setEditingFieldPath(null); setSelectedFieldDefaults(null); }}
              />
            );
          })()}

          {selectedFieldPath && selectedFieldDefaults?.kind === 'shape' && (() => {
            const fieldOverride = deck?.outlineJson?.slides[selectedIndex]?.layoutOverrides?.[selectedFieldPath] || {};
            const radius = fieldOverride.radius ?? selectedFieldDefaults.radius;
            return (
              <ShapeRadiusToolbar
                radius={radius}
                onChangeRadius={(next) => handleCommitFieldOverride(selectedFieldPath, { radius: next }, { persist: false })}
                onBlurRadius={persistCurrentFieldOverrides}
                disabled={freeformDisabled}
                actions={parseDeletableFieldPath(selectedFieldPath) && (
                  <DeleteFieldAction onClick={handleDeleteField} disabled={freeformDisabled} />
                )}
                onDone={() => { setSelectedFieldPath(null); setEditingFieldPath(null); setSelectedFieldDefaults(null); }}
              />
            );
          })()}

          {selectedFieldPath === 'heroImage' && selectedFieldDefaults?.kind === 'image' && (
            <HeroImageToolbar
              onReplace={() => { setImagePickTarget('heroImage'); setActiveTool('uploads'); }}
              onRemove={handleRemoveHeroImage}
              disabled={freeformDisabled}
              onDone={() => { setSelectedFieldPath(null); setEditingFieldPath(null); setSelectedFieldDefaults(null); }}
            />
          )}

          {/* Floating style toolbar for a selected image — a trimmed version
              of the shape toolbar below with only Opacity, since
              fill/stroke/width don't apply to a photo. */}
          {selectedElement && selectedElement.kind === 'image' && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 z-20 flex items-center gap-3 px-4 py-2 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400 dark:text-gray-500">Opacity</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={Number.isFinite(selectedElement.opacity) ? selectedElement.opacity : 1}
                  onChange={(e) => applyElementPatch(selectedElement.id, { opacity: Number(e.target.value) })}
                  onMouseUp={persistCurrentElements}
                  onTouchEnd={persistCurrentElements}
                  onBlur={persistCurrentElements}
                  disabled={freeformDisabled}
                  className="w-20 disabled:opacity-50"
                />
              </div>

              <ElementActionButtons
                onDuplicate={handleDuplicateElement}
                onReorderLayer={handleReorderLayer}
                onDelete={handleDeleteElement}
                disabled={freeformDisabled}
              />

              <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

              <button
                type="button"
                onClick={() => { setSelectedElementId(null); setEditingElementId(null); }}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                Done
              </button>
            </div>
          )}

          {/* Floating style toolbar for a selected shape (rect/ellipse/line)
              — same floating/non-shifting placement as the text toolbar
              above, just a different field set. Lines have no fill, so that
              control is skipped. */}
          {selectedElement && selectedElement.kind !== 'text' && selectedElement.kind !== 'image' && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 z-20 flex items-center gap-3 px-4 py-2 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              {selectedElement.kind !== 'line' && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">Fill</span>
                  <input
                    type="color"
                    value={`#${selectedElement.fill || 'FFFFFF'}`}
                    onChange={(e) => applyElementPatch(selectedElement.id, { fill: e.target.value.replace('#', '').toUpperCase() }, { persist: true, coalesceKey: `fill:${selectedElement.id}` })}
                    disabled={freeformDisabled}
                    title="Fill color"
                    className="h-7 w-7 rounded border border-gray-300 dark:border-gray-700 cursor-pointer bg-transparent p-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {selectedElement.fill && (
                    <button
                      type="button"
                      onClick={() => applyElementPatch(selectedElement.id, { fill: null }, { persist: true })}
                      disabled={freeformDisabled}
                      title="No fill"
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              {selectedElement.kind !== 'line' && <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />}

              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400 dark:text-gray-500">Stroke</span>
                <input
                  type="color"
                  value={`#${selectedElement.stroke || '1A1A1A'}`}
                  onChange={(e) => applyElementPatch(selectedElement.id, { stroke: e.target.value.replace('#', '').toUpperCase() }, { persist: true, coalesceKey: `stroke:${selectedElement.id}` })}
                  disabled={freeformDisabled}
                  title="Stroke color"
                  className="h-7 w-7 rounded border border-gray-300 dark:border-gray-700 cursor-pointer bg-transparent p-0 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {selectedElement.stroke && selectedElement.kind !== 'line' && (
                  <button
                    type="button"
                    onClick={() => applyElementPatch(selectedElement.id, { stroke: null }, { persist: true })}
                    disabled={freeformDisabled}
                    title="No stroke"
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400 dark:text-gray-500">Width</span>
                <input
                  type="number"
                  min={0}
                  max={40}
                  value={selectedElement.strokeWidth}
                  onChange={(e) => applyElementPatch(selectedElement.id, { strokeWidth: Number(e.target.value) })}
                  onBlur={persistCurrentElements}
                  disabled={freeformDisabled}
                  className="w-12 text-center rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 text-xs px-1 py-1 disabled:opacity-50"
                />
              </div>

              <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400 dark:text-gray-500">Opacity</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={Number.isFinite(selectedElement.opacity) ? selectedElement.opacity : 1}
                  onChange={(e) => applyElementPatch(selectedElement.id, { opacity: Number(e.target.value) })}
                  onMouseUp={persistCurrentElements}
                  onTouchEnd={persistCurrentElements}
                  onBlur={persistCurrentElements}
                  disabled={freeformDisabled}
                  className="w-20 disabled:opacity-50"
                />
              </div>

              <ElementActionButtons
                onDuplicate={handleDuplicateElement}
                onReorderLayer={handleReorderLayer}
                onDelete={handleDeleteElement}
                disabled={freeformDisabled}
              />

              <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

              <button
                type="button"
                onClick={() => { setSelectedElementId(null); setEditingElementId(null); }}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                Done
              </button>
            </div>
          )}

          {/* Floating align/distribute toolbar for a multi-selection — same
              floating placement as the single-element toolbars above.
              Distribute only makes sense with 3+ elements (2 elements have
              exactly one gap, nothing to even out), so those two buttons
              stay disabled until then. */}
          {selectedElementIds.length >= 2 && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 z-20 flex items-center gap-1 px-4 py-2 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">{selectedElementIds.length} selected</span>

              {[
                { action: 'left', Icon: AlignHorizontalJustifyStart, title: 'Align left' },
                { action: 'hcenter', Icon: AlignHorizontalJustifyCenter, title: 'Align center' },
                { action: 'right', Icon: AlignHorizontalJustifyEnd, title: 'Align right' },
              ].map(({ action, Icon, title }) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => handleAlignDistribute(action)}
                  disabled={freeformDisabled}
                  title={title}
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}

              <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

              {[
                { action: 'top', Icon: AlignVerticalJustifyStart, title: 'Align top' },
                { action: 'vmiddle', Icon: AlignVerticalJustifyCenter, title: 'Align middle' },
                { action: 'bottom', Icon: AlignVerticalJustifyEnd, title: 'Align bottom' },
              ].map(({ action, Icon, title }) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => handleAlignDistribute(action)}
                  disabled={freeformDisabled}
                  title={title}
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}

              <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

              <button
                type="button"
                onClick={() => handleAlignDistribute('distributeH')}
                disabled={freeformDisabled || selectedElementIds.length < 3}
                title="Distribute horizontally"
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <AlignHorizontalDistributeCenter className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleAlignDistribute('distributeV')}
                disabled={freeformDisabled || selectedElementIds.length < 3}
                title="Distribute vertically"
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <AlignVerticalDistributeCenter className="w-3.5 h-3.5" />
              </button>

              <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

              <button
                type="button"
                onClick={() => { setSelectedElementId(null); setEditingElementId(null); }}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                Done
              </button>
            </div>
          )}
        </div>

        {/* Body */}
        {!deck ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
          </div>
        ) : !outline ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
            <div className="w-14 h-14 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
              <Presentation className="w-7 h-7 text-gray-400" />
            </div>
            <h3 className="text-base font-medium text-gray-900 dark:text-gray-100 mb-2">
              Live preview isn&apos;t available for this deck
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
              This deck was generated before live preview & editing existed. Regenerate it from the Slides tab to enable this view.
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 flex">
              {/* Left: tools panel */}
              <LeftToolsPanel
                activeTool={activeTool}
                onSelectTool={(tool) => { setImagePickTarget(null); setActiveTool((t) => (t === tool ? null : tool)); }}
                disabled={freeformDisabled}
              />

              {activeTool === 'text' && (
                <TextPanel
                  onAddText={handleAddText}
                  disabled={freeformDisabled}
                  onClose={() => setActiveTool(null)}
                />
              )}

              {activeTool === 'shape' && (
                <ShapesPanel
                  onAddShape={handleAddShape}
                  disabled={freeformDisabled}
                  onClose={() => setActiveTool(null)}
                />
              )}

              {activeTool === 'uploads' && (
                <UploadsPanel
                  documentId={deck?.documentId}
                  userId={deck?.document?.userId}
                  projectId={deck?.document?.projectId}
                  deckId={deckId}
                  slideIndex={selectedIndex}
                  onInsertImage={imagePickTarget === 'heroImage' ? handlePickHeroImage : handleAddImage}
                  title={imagePickTarget === 'heroImage' ? 'Replace hero image' : 'Uploads'}
                  insertLabel={imagePickTarget === 'heroImage' ? 'Use this image' : 'Insert into slide'}
                  onClose={() => { setActiveTool(null); setImagePickTarget(null); }}
                  disabled={freeformDisabled}
                />
              )}

              {activeTool === 'background' && (
                <BackgroundPanel
                  backgroundColor={outline.slides[selectedIndex]?.backgroundColor}
                  onSetBackground={handleSetBackground}
                  brandColors={outline.brandKit?.colors || null}
                  saving={savingBackground}
                  disabled={freeformDisabled}
                  onClose={() => setActiveTool(null)}
                />
              )}

              {/* Center: main preview */}
              <div
                ref={previewRef}
                className="relative flex-1 flex items-center justify-center overflow-auto bg-gray-100 dark:bg-gray-950 p-4"
                onClick={() => {
                  if (suppressNextDeselectRef.current) { suppressNextDeselectRef.current = false; return; }
                  setSelectedElementId(null);
                  setEditingElementId(null);
                  setSelectedFieldPath(null);
                  setEditingFieldPath(null);
                }}
              >
                <div ref={setStageEl} className="shadow-xl">
                  <SlideRenderer
                    slide={outline.slides[selectedIndex]}
                    theme={theme}
                    scale={mainScale}
                    slideIndex={selectedIndex}
                    interactiveElements
                    selectedElementIds={selectedElementIds}
                    editingElementId={editingElementId}
                    onSelectElement={setSelectedElementId}
                    onToggleSelectElement={handleToggleSelectElement}
                    onStartEditingElement={handleStartEditingElement}
                    onCommitElementText={(elementId, text) => { applyElementPatch(elementId, { text }, { persist: true }); setEditingElementId(null); }}
                    onCommitElementTransform={handleCommitElementTransform}
                    onCommitField={handleCommitField}
                    selectedFieldPath={selectedFieldPath}
                    editingFieldPath={editingFieldPath}
                    onSelectField={handleSelectField}
                    onStartEditingField={handleStartEditingField}
                    onCommitFieldOverride={handleCommitFieldOverride}
                  />
                </div>
                {/* Marquee (rubber-band) multi-select. dragContainer/container
                    are the whole scrollable preview pane (previewRef), not
                    just the slide's own tight bounding box (stageEl) — a
                    marquee naturally starts from empty space, which is very
                    often just outside the slide's edge (the surrounding
                    canvas padding); scoping the drag listener to stageEl
                    meant a gesture starting there never registered as a drag
                    at all, so nothing ever got selected. selectableTargets
                    also matches `[data-field-path]` (every interactive
                    TextBox/Shape/InteractiveCircle in SlideRenderer.jsx now
                    carries one) so a drag over a single piece of generated
                    content selects it too, not just freeform elements —
                    selectedFieldPath is single-select only though (see its
                    declaration comment), so onSelectEnd below picks just the
                    SMALLEST-area matched template field when the drag swept
                    up no freeform elements (see its own comment for why
                    "smallest", not "first" or "outermost"). A drag gesture
                    starting ON an existing freeform element or template
                    field is left alone (onDragStart below hands it back to
                    that element's own click/Moveable handling instead of
                    starting a selection rectangle). */}
                {stageEl && (
                  <Selecto
                    container={previewRef.current}
                    dragContainer={previewRef.current}
                    selectableTargets={['[data-freeform-id]', '[data-field-path]']}
                    selectByClick={false}
                    selectFromInside={false}
                    toggleContinueSelect={['shift']}
                    hitRate={0}
                    onDragStart={(e) => {
                      const target = e.inputEvent?.target;
                      if (target?.closest?.('[data-freeform-id], [data-field-path]')) e.stop();
                    }}
                    onSelectEnd={(e) => {
                      const ids = e.selected.map((el) => el.getAttribute('data-freeform-id')).filter(Boolean);
                      if (ids.length > 0) {
                        suppressNextDeselectRef.current = true;
                        setTimeout(() => { suppressNextDeselectRef.current = false; }, 0);
                        setSelectedElementIds(ids);
                        setEditingElementId(null);
                        setSelectedFieldPath(null);
                        setEditingFieldPath(null);
                        return;
                      }
                      // Picks the SMALLEST (most specific) matched field, not
                      // the one DOM .contains() the others — a card and its
                      // own label/icon/description are DOM SIBLINGS (see
                      // ChecklistRows/IconGridSlide/etc.'s per-item markup),
                      // not nested, even though the card visually sits under
                      // the label. With hitRate=0 (any overlap counts), a
                      // drag anywhere near a card-based item's text almost
                      // always also overlaps its card, so requiring one
                      // single DOM-outermost match left this effectively
                      // never firing for the most common slide types. Area
                      // comparison sees what the eye sees (the label's box is
                      // smaller and sits inside the card's), and always picks
                      // something whenever the drag touched at least one
                      // field — same "pick the specific thing" semantics a
                      // direct click already has.
                      const fieldEls = e.selected.filter((el) => el.hasAttribute('data-field-path'));
                      if (fieldEls.length === 0) return;
                      let smallest = fieldEls[0];
                      let smallestArea = Infinity;
                      for (const el of fieldEls) {
                        const r = el.getBoundingClientRect();
                        const area = r.width * r.height;
                        if (area < smallestArea) { smallest = el; smallestArea = area; }
                      }
                      suppressNextDeselectRef.current = true;
                      setTimeout(() => { suppressNextDeselectRef.current = false; }, 0);
                      smallest.click();
                    }}
                  />
                )}

                <div
                  className="absolute bottom-3 right-3 flex items-center gap-1 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 px-1 py-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                    title="Zoom out"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-10 text-center text-xs tabular-nums text-gray-600 dark:text-gray-300">{Math.round(zoom * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                    title="Zoom in"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Right: edit panel */}
              <div className="w-80 shrink-0 border-l border-gray-200 dark:border-gray-700 flex flex-col">
                <div className="shrink-0">
                  <ThemeSelector
                    palettes={PALETTES}
                    activePaletteName={outline.paletteName}
                    onSelect={handleSelectPalette}
                    disabled={!!applyingPalette || isEditing || isReordering || deck.status !== 'ready'}
                    applyingName={applyingPalette}
                    brandColors={outline.brandKit?.colors || null}
                    isBrandActive={!!outline.brandKit?.active}
                    onSelectBrand={handleSelectBrandPalette}
                  />
                  {themeError && (
                    <div className="mx-3 mt-2 text-xs px-2 py-1.5 rounded-md bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                      {themeError}
                    </div>
                  )}
                </div>

                <div className="shrink-0 p-3 border-b border-gray-200 dark:border-gray-700 flex gap-1">
                  <Button
                    variant={mode === 'deck' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setMode('deck')}
                    className={cn(
                      'flex-1 flex items-center justify-center space-x-2',
                      mode === 'deck' ? 'text-white dark:text-gray-200' : 'text-gray-600 dark:text-gray-400'
                    )}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span>Whole Deck</span>
                  </Button>
                  <Button
                    variant={mode === 'slide' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setMode('slide')}
                    className={cn(
                      'flex-1 flex items-center justify-center space-x-2',
                      mode === 'slide' ? 'text-white dark:text-gray-200' : 'text-gray-600 dark:text-gray-400'
                    )}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>Current Slide</span>
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 text-sm text-gray-500 dark:text-gray-400 space-y-2">
                  <p>
                    {mode === 'deck'
                      ? 'Edits apply to the whole deck — content depth, structure, or color/theme changes.'
                      : `Edits apply only to slide ${selectedIndex + 1} ("${outline.slides[selectedIndex]?.title || outline.slides[selectedIndex]?.type}"). Color/theme requests still apply to the whole deck, to keep it cohesive.`}
                  </p>
                  {mode === 'deck' && manualEditSlideCount > 0 && (
                    <div className="text-xs px-2 py-1.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                      {manualEditSlideCount} slide{manualEditSlideCount === 1 ? '' : 's'} {manualEditSlideCount === 1 ? 'has' : 'have'} manual edits — positions/colors will be kept, but content may be rewritten.
                    </div>
                  )}
                  {deck.status === 'generating' && (
                    <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Applying edit…</span>
                    </div>
                  )}
                  {lastError && (
                    <div className="text-xs px-2 py-1.5 rounded-md bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                      {lastError}
                    </div>
                  )}
                  {lastInstruction && !isEditing && !lastError && (
                    <div className="text-xs px-2 py-1.5 rounded-md bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 flex items-start gap-1.5">
                      <RefreshCw className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>Last edit: &quot;{lastInstruction}&quot;</span>
                    </div>
                  )}
                </div>

                <form onSubmit={handleSubmit} className="shrink-0 p-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
                  <textarea
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder={mode === 'deck' ? 'e.g. Use a warmer, more energetic color palette' : 'e.g. Add more specific detail from the document'}
                    disabled={isEditing || !!applyingPalette || isReordering}
                    rows={3}
                    className={cn(
                      'flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm resize-none',
                      'placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-600 focus:border-transparent',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-400'
                    )}
                  />
                  <Button type="submit" size="sm" disabled={!instruction.trim() || isEditing || !!applyingPalette || isReordering} className="w-full flex items-center justify-center space-x-2">
                    {isEditing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    <span>{isEditing ? 'Applying…' : 'Apply Edit'}</span>
                  </Button>
                </form>
              </div>
            </div>

            {/* Bottom: thumbnail filmstrip */}
            <SlideThumbnailRail
              orientation="horizontal"
              slides={outline.slides}
              theme={theme}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              disabled={reorderDisabled}
              reorderError={reorderError}
              onReorder={handleReorder}
              onDuplicate={handleDuplicate}
              onDelete={handleDeleteSlide}
            />
          </div>
        )}
      </div>
      {isPresenting && outline && (
        <div
          ref={presentRef}
          className="fixed inset-0 z-70 bg-black flex items-center justify-center select-none"
          onClick={() => setSelectedIndex((i) => Math.min(outline.slides.length - 1, i + 1))}
        >
          <SlideRenderer slide={outline.slides[selectedIndex]} theme={theme} scale={presentScale} slideIndex={selectedIndex} />

          <button
            onClick={(e) => { e.stopPropagation(); exitPresentation(); }}
            className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Exit presentation (Esc)"
          >
            <X className="w-5 h-5" />
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); setSelectedIndex((i) => Math.max(0, i - 1)); }}
            disabled={selectedIndex === 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 disabled:cursor-not-allowed text-white transition-colors"
            title="Previous (←)"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setSelectedIndex((i) => Math.min(outline.slides.length - 1, i + 1)); }}
            disabled={selectedIndex === outline.slides.length - 1}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 disabled:cursor-not-allowed text-white transition-colors"
            title="Next (→)"
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          <div className="absolute bottom-4 right-4 text-white/60 text-xs font-medium tabular-nums">
            {selectedIndex + 1} / {outline.slides.length}
          </div>
        </div>
      )}
    </>
  );
}
