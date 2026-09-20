// src/lib/slides/iconNames.js
// Just the icon-name whitelist (~60 keys, the LLM-facing ~59-entry subset)
// as plain data — split out of icons.js so outline.js/edit.js (which only
// need the NAMES for prompt-building) never pull in icons.js's React/
// ReactDOMServer/@resvg-wasm rasterization imports. Next's bundler flags
// any Server Component / API Route that transitively imports
// `react-dom/server` — outline.js is imported from API routes, so it must
// only ever depend on this lightweight file, never icons.js itself.
//
// Must stay in exact sync with icons.js's ICONS map keys (icons.js exports
// its own ICON_NAMES derived the same way, for anything that needs the
// actual icon components + rasterization).
export const ICON_NAMES = [
  "check-circle", "x-circle", "lightbulb", "chart-line", "chart-bar", "chart-pie",
  "chart-area", "target", "users", "user", "calendar", "clock", "flag", "star",
  "award", "shield", "lock", "unlock", "globe", "mail", "phone",
  "map-pin", "briefcase", "book", "file-text", "layers", "dollar-sign",
  "percent", "alert-triangle", "info", "help-circle",
  "arrow-right", "trending-up", "trending-down", "thumbs-up", "settings", "gears", "database",
  "server", "cloud", "link", "search", "filter", "list", "grid", "message-circle",
  "heart", "zap", "rocket", "handshake", "building", "graduation-cap", "leaf",
  "heartbeat", "balance-scale", "puzzle", "clipboard-list", "tasks", "sitemap",
];
