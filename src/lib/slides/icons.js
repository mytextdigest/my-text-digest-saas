// src/lib/slides/icons.js
// Icon pipeline for slide decks (server side — worker render + synchronous
// mutation routes): SVG -> PNG, so icons render identically across
// PowerPoint/Keynote/LibreOffice instead of relying on font-icon glyphs
// being installed on the viewer's machine.
//
// Ported from electron/slides/icons.js, with the rasterization technique
// swapped per the feature spec's "no sharp/no native binary" constraint:
// desktop renders react-icons/lu -> sharp (libvips, native binary per
// platform). This repo has no sharp. Two changes:
//   1. Icon SHAPES come from `lucide-react` (already a dependency here)
//      instead of `react-icons/lu` — both packages wrap the exact same
//      Lucide icon set, just with different component-naming conventions
//      (react-icons prefixes "Lu", lucide-react doesn't), so this is a
//      same-source swap, not a visual change. The SVG is built directly
//      from each component's own `iconNode` prop (an array of [tagName,
//      attrs] pairs a forwardRef lucide-react component always carries —
//      calling `IconComponent.render(props, null).props.iconNode` reads it
//      without ever invoking React's own renderer), NOT via
//      `react-dom/server` — Next's bundler (Turbopack, this repo's default)
//      hard-fails any Route that transitively imports `react-dom/server`,
//      and every synchronous mutation route calls into this file via
//      buildDeck.js, so that dependency has to be avoided entirely, not
//      just isolated.
//   2. RASTERIZATION uses `@resvg/resvg-wasm` (a WebAssembly build — no
//      per-platform native `.node` binary to prebuild/deploy, the one
//      genuinely unavoidable place this port needs a real vector
//      rasterizer, since Lucide icons are arbitrary bezier/arc paths).
//      This file is imported both from Next.js API routes (bundled by
//      Turbopack) and from the standalone worker process (plain Node ESM,
//      never touched by any bundler). Turbopack statically finds and tries
//      to bundle any *literal* `require("@resvg/resvg-wasm")` /
//      `require.resolve("@resvg/resvg-wasm/...")` call written in this
//      file's real source, regardless of which runtime branch would
//      actually execute it (confirmed by testing) — and it can't bundle
//      this package's wasm-bindgen loader shim, hard-failing the build.
//      `require`/`createRequire` themselves are obtained normally below
//      (that part was never the problem); only the two calls that pass
//      "@resvg/resvg-wasm"'s literal name are wrapped in `eval(...)` (see
//      ensureWasmInit), since a string's contents are invisible to
//      Turbopack's static source parser — a well-established technique for
//      exactly this class of bundler-vs-wasm/native-module conflict.
//
// The LLM (outline.js) can only reference icons by the names in ICONS below
// — never freeform — so a hallucinated/unsupported name just means "no
// icon" rather than a crash.

import fs from "fs";
import { createRequire } from "module";
import {
  CircleCheck, CircleX, Lightbulb, ChartLine, ChartBar, ChartPie,
  ChartArea, Target, Users, User, Calendar, Clock, Flag, Star,
  Award, Shield, Lock, LockOpen, Globe, Mail, Phone,
  MapPin, Briefcase, Book, FileText, Layers, DollarSign,
  Percent, TriangleAlert, Info, CircleHelp,
  ArrowRight, TrendingUp, TrendingDown, ThumbsUp, Settings, Cog, Database,
  Server, Cloud, Link, Search, Filter, List, LayoutGrid, MessageCircle,
  Heart, Zap, Rocket, Handshake, Building, GraduationCap, Leaf,
  HeartPulse, Scale, Puzzle, ClipboardList, ListChecks, Network, Check,
} from "lucide-react";

export const ICONS = {
  "check-circle": CircleCheck,
  "x-circle": CircleX,
  "lightbulb": Lightbulb,
  "chart-line": ChartLine,
  "chart-bar": ChartBar,
  "chart-pie": ChartPie,
  "chart-area": ChartArea,
  "target": Target,
  "users": Users,
  "user": User,
  "calendar": Calendar,
  "clock": Clock,
  "flag": Flag,
  "star": Star,
  "award": Award,
  "shield": Shield,
  "lock": Lock,
  "unlock": LockOpen,
  "globe": Globe,
  "mail": Mail,
  "phone": Phone,
  "map-pin": MapPin,
  "briefcase": Briefcase,
  "book": Book,
  "file-text": FileText,
  "layers": Layers,
  "dollar-sign": DollarSign,
  "percent": Percent,
  "alert-triangle": TriangleAlert,
  "info": Info,
  "help-circle": CircleHelp,
  "arrow-right": ArrowRight,
  "trending-up": TrendingUp,
  "trending-down": TrendingDown,
  "thumbs-up": ThumbsUp,
  "settings": Settings,
  "gears": Cog,
  "database": Database,
  "server": Server,
  "cloud": Cloud,
  "link": Link,
  "search": Search,
  "filter": Filter,
  "list": List,
  "grid": LayoutGrid,
  "message-circle": MessageCircle,
  "heart": Heart,
  "zap": Zap,
  "rocket": Rocket,
  "handshake": Handshake,
  "building": Building,
  "graduation-cap": GraduationCap,
  "leaf": Leaf,
  "heartbeat": HeartPulse,
  "balance-scale": Scale,
  "puzzle": Puzzle,
  "clipboard-list": ClipboardList,
  "tasks": ListChecks,
  "sitemap": Network,
  // Not part of the LLM-facing whitelist (ICON_NAMES below excludes it) —
  // used internally for checklist-style bullets in layouts.js.
  "check": Check,
};

// "check" is a code-only glyph (checklist bullets), not offered to the LLM.
export const ICON_NAMES = Object.keys(ICONS).filter((n) => n !== "check");

// name:color:size -> PNG Buffer. Icons are static assets — safe to cache for
// the lifetime of the process, not just one deck build.
const rasterCache = new Map();

// Serializes one [tagName, attrs] node (lucide-react's own internal shape —
// every icon is just an array of these, generic across circle/path/rect/
// line/polyline/ellipse) into an SVG element string. `key` is React's own
// list-reconciliation prop, never a real SVG attribute — dropped here.
function serializeIconNode([tag, attrs]) {
  const attrStr = Object.entries(attrs)
    .filter(([k]) => k !== "key")
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  return `<${tag} ${attrStr}/>`;
}

// Builds the exact SVG markup a lucide-react component would render to the
// DOM, without going through React/react-dom at all — reads `iconNode`
// directly off the element `IconComponent.render(...)` returns (every
// lucide-react icon is a thin forwardRef wrapper around a shared base
// component that takes this same iconNode + color/size/strokeWidth shape).
// strokeWidth bumped slightly above Lucide's default (2) — thin strokes at
// default weight read as faint once rasterized down to icon-circle sizes on
// a slide.
function renderIconSvg(IconComponent, colorHex, size) {
  const element = IconComponent.render({ color: `#${colorHex}`, size: String(size), strokeWidth: 2.25 }, null);
  const { iconNode } = element.props;
  const body = iconNode.map(serializeIconNode).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="#${colorHex}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">` +
    `${body}</svg>`
  );
}

let resvgModule = null;
let wasmReady = null;
function ensureWasmInit() {
  if (!wasmReady) {
    wasmReady = (async () => {
      // Next.js API routes run through Turbopack, which always injects a
      // real `require` into its compiled module wrapper even though this
      // file is authored as ESM — so `require` is genuinely in scope there.
      // The standalone worker process runs this same file as plain,
      // unbundled Node ESM, where no ambient `require` exists at all, so it
      // falls back to `createRequire`. Neither of these two lines is the
      // problem (Turbopack builds fine with both present) — only the two
      // literal "@resvg/resvg-wasm" call sites below need hiding from its
      // static analysis, via `eval`.
      const nodeRequire = typeof require !== "undefined" ? require : createRequire(import.meta.url);
      resvgModule = eval(`nodeRequire("@resvg/resvg-wasm")`);
      const wasmPath = eval(`nodeRequire.resolve("@resvg/resvg-wasm/index_bg.wasm")`);
      const wasmBuffer = fs.readFileSync(wasmPath);
      await resvgModule.initWasm(wasmBuffer);
    })();
  }
  return wasmReady;
}

// Never throws — returns null for an unknown icon name (or a rasterization
// failure) so callers can just skip the icon instead of failing the whole
// slide. Returns the same `"image/png;base64,<...>"` data-URI string shape
// desktop's iconToBase64Png did (pptxgenjs's addImage `data` field is typed
// as a base64-encoded string, not a raw buffer) — keeps every layouts.js
// call site an unchanged drop-in.
export async function iconToBase64Png(name, colorHex, size = 256) {
  const IconComponent = ICONS[name];
  if (!IconComponent) return null;

  const cacheKey = `${name}:${colorHex}:${size}`;
  if (rasterCache.has(cacheKey)) return rasterCache.get(cacheKey);

  try {
    await ensureWasmInit();
    const svg = renderIconSvg(IconComponent, colorHex, size);
    const resvg = new resvgModule.Resvg(svg, { fitTo: { mode: "width", value: size } });
    const pngBuffer = Buffer.from(resvg.render().asPng());
    const dataUri = "image/png;base64," + pngBuffer.toString("base64");
    rasterCache.set(cacheKey, dataUri);
    return dataUri;
  } catch (err) {
    console.error("iconToBase64Png error:", name, err.message || err);
    return null;
  }
}
