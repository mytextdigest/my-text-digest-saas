// Shared entity-type styling for the knowledge graph views (document Graph
// tab and the project-level cross-document view). Kept centralized so the
// node colors in the canvas, the legend, and the detail panel badge always
// agree with each other.
export const ENTITY_TYPES = ["person", "organization", "location", "product", "concept", "event", "date", "metric", "misc"];

export const TYPE_LABELS = {
  person: "Person",
  organization: "Organization",
  location: "Location",
  product: "Product",
  concept: "Concept",
  event: "Event",
  date: "Date",
  metric: "Metric",
  misc: "Other",
};

// Tailwind classes per type — dot swatch, node border/background/text, and a
// standalone badge variant, all sharing the same hue so the legend, canvas
// nodes, and detail-panel badge read as one system in both themes.
export const TYPE_STYLES = {
  person: {
    dot: "bg-blue-500",
    node: "border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  organization: {
    dot: "bg-violet-500",
    node: "border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-800 dark:text-violet-200",
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  },
  location: {
    dot: "bg-emerald-500",
    node: "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  product: {
    dot: "bg-amber-500",
    node: "border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  concept: {
    dot: "bg-pink-500",
    node: "border-pink-500 bg-pink-50 dark:bg-pink-950/40 text-pink-800 dark:text-pink-200",
    badge: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  },
  event: {
    dot: "bg-cyan-500",
    node: "border-cyan-500 bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-200",
    badge: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  },
  date: {
    dot: "bg-gray-400",
    node: "border-gray-400 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300",
    badge: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
  metric: {
    dot: "bg-indigo-500",
    node: "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200",
    badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  },
  misc: {
    dot: "bg-gray-400",
    node: "border-gray-400 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300",
    badge: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
};

export function styleForType(type) {
  return TYPE_STYLES[type] || TYPE_STYLES.misc;
}

// Filled-circle node colors for the force-directed canvas (EntityGraphCanvas/
// EntityNode) — a fixed-order categorical palette (never cycled/generated),
// validated with the dataviz skill's validate_palette.js against both chart
// surfaces (all PASS; light mode carries a contrast-vs-page-surface WARN on
// 3 slots, mitigated here since every node always carries a visible text
// label — identity is never color-alone). `text` is computed per-fill via
// WCAG contrast (not assumed white), since several of these fills are light.
//
// "metric" intentionally has no hue of its own: the palette is validated at
// 8 slots, and the dataviz skill's rule is that a 9th series folds into
// "Other" rather than getting a generated color. It shares misc's fill and
// is instead told apart by shape/content in EntityNode (its value is shown
// on the node itself, e.g. "46.2%", rather than just a name).
export const NODE_FILL = {
  person:       { fill: "#2a78d6", text: "#0b0b0b" },
  organization: { fill: "#eb6834", text: "#0b0b0b" },
  location:     { fill: "#1baf7a", text: "#0b0b0b" },
  product:      { fill: "#eda100", text: "#0b0b0b" },
  concept:      { fill: "#e87ba4", text: "#0b0b0b" },
  event:        { fill: "#008300", text: "#ffffff" },
  date:         { fill: "#4a3aa7", text: "#ffffff" },
  misc:         { fill: "#e34948", text: "#0b0b0b" },
  metric:       { fill: "#e34948", text: "#0b0b0b" },
};

export function fillForType(type) {
  return NODE_FILL[type] || NODE_FILL.misc;
}
