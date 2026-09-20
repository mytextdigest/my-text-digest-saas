// Category badge styling for the Insights panel (InsightsPanel.jsx). Mirrors
// entityStyles.js's TYPE_STYLES pattern but for narrative-insight categories
// (electron/graph/narrativeInsights.js's CATEGORIES) rather than entity
// types — kept in its own file since these are a different concept (a
// synthesized insight's classification, not an extracted entity's type) and
// share no values with entityStyles.js. These are plain UI badge chips, not
// chart data-ink, so they aren't bound by the dataviz skill's categorical
// hue-count/validation rules the graph canvas fills follow.
export const INSIGHT_CATEGORIES = ["Growth", "Financial", "Operations", "Risk", "Market", "Strategic", "Other"];

const CATEGORY_STYLES = {
  Growth: { badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  Financial: { badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  Operations: { badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  Risk: { badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  Market: { badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  Strategic: { badge: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300" },
  Other: { badge: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};

export function categoryStyle(category) {
  return CATEGORY_STYLES[category] || CATEGORY_STYLES.Other;
}
