// src/lib/slides/content.js
// Direct (non-LLM) edits to an EXISTING slide's own template content fields
// (title, bullets, item labels/descriptions, stat values, quote, ...) — the
// backend for clicking directly into a slide's text and typing. Deliberately
// separate from outline.js's validateSlide/validateOutline: those exist to
// keep AI-GENERATED content from being thin (word floors, redundancy
// filtering, isSubstantive checks) — a human directly editing their own
// deck should never have text silently deleted for being "too short" or
// "not substantive enough." Only length/shape caps apply here, reusing the
// same constants outline.js enforces at generation time.
//
// Ported near-verbatim from electron/slides/content.js.

import {
  MAX_TITLE_LEN, MAX_BULLET_LEN, MAX_BULLETS, MAX_ITEMS, MAX_ITEM_DESC_LEN, MAX_STATS,
  MAX_TABLE_COLS, MAX_TABLE_ROWS, MAX_TABLE_CELL_LEN,
} from "./outline.js";

// Which top-level slide fields a direct content edit is allowed to touch,
// per slide type — mirrors the field set validateSlide's switch already
// establishes per type, just without the content-quality gating.
export const EDITABLE_FIELDS_BY_TYPE = {
  title: ["title", "subtitle"],
  section_header: ["title", "subtitle"],
  closing: ["title", "subtitle", "bullets"],
  agenda: ["title", "bullets"],
  bullets: ["title", "bullets"],
  two_column: ["title", "bullets"],
  icon_grid: ["title", "items"],
  icon_list: ["title", "items"],
  timeline: ["title", "items"],
  process_steps: ["title", "items"],
  feature_split: ["title", "panelLabel", "items"],
  stat_callout: ["title", "context", "stats"],
  comparison: ["title", "items"],
  chart: ["title"],
  quote: ["quote", "attribution"],
  table: ["title", "table"],
};

function truncateString(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

function sanitizeItem(slideType, raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = { label: truncateString(raw.label, MAX_TITLE_LEN) };
  if (typeof raw.icon === "string") out.icon = raw.icon;
  if (raw.description !== undefined) out.description = truncateString(raw.description, MAX_ITEM_DESC_LEN);
  if (slideType === "comparison" && Array.isArray(raw.bullets)) {
    out.bullets = raw.bullets.slice(0, 5).map((b) => truncateString(String(b ?? ""), MAX_BULLET_LEN));
  }
  return out;
}

// Unlike outline.js's validateTableData (used for AI-generated tables),
// this never drops a row for having an empty cell — that fits AI-generation
// quality gating, not a human directly editing an already-approved table
// (see this file's header comment). Instead every row is padded/truncated
// to exactly headers.length cells, so the table's shape always stays valid
// for rendering without ever discarding what the user typed.
function sanitizeTable(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const headers = Array.isArray(raw.headers)
    ? raw.headers.slice(0, MAX_TABLE_COLS).map((h) => truncateString(h, MAX_TABLE_CELL_LEN))
    : [];
  if (headers.length < 2) return undefined;
  const rows = (Array.isArray(raw.rows) ? raw.rows : [])
    .slice(0, MAX_TABLE_ROWS)
    .map((row) => {
      const cells = Array.isArray(row) ? row : [];
      return headers.map((_, i) => truncateString(cells[i], MAX_TABLE_CELL_LEN));
    });
  return { headers, rows };
}

function sanitizeField(slideType, field, value) {
  switch (field) {
    case "title":
      return truncateString(value, MAX_TITLE_LEN);
    case "subtitle":
      return truncateString(value, 240);
    case "panelLabel":
      return truncateString(value, 60);
    case "context":
      return truncateString(value, 220);
    case "quote":
      return truncateString(value, 300);
    case "attribution":
      return truncateString(value, 100);
    case "bullets":
      return Array.isArray(value) ? value.slice(0, MAX_BULLETS).map((b) => truncateString(String(b ?? ""), MAX_BULLET_LEN)) : [];
    case "items":
      return Array.isArray(value) ? value.slice(0, MAX_ITEMS).map((item) => sanitizeItem(slideType, item)).filter(Boolean) : [];
    case "stats":
      return Array.isArray(value)
        ? value.slice(0, MAX_STATS).map((s) => ({ value: truncateString(s?.value, 20), label: truncateString(s?.label, 80) }))
        : [];
    case "table":
      return sanitizeTable(value);
    default:
      return undefined;
  }
}

// Never throws — an unknown type/field is simply dropped from the returned
// patch rather than erroring, same never-throws convention as outline.js.
export function validateContentPatch(slideType, rawPatch) {
  if (!rawPatch || typeof rawPatch !== "object") return {};
  const allowed = EDITABLE_FIELDS_BY_TYPE[slideType] || [];
  const out = {};
  for (const field of allowed) {
    if (!Object.prototype.hasOwnProperty.call(rawPatch, field)) continue;
    const sanitized = sanitizeField(slideType, field, rawPatch[field]);
    if (sanitized !== undefined) out[field] = sanitized;
  }
  return out;
}
