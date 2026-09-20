// src/lib/slides/intent.js
// Post-generation visibility check: presentationType was previously
// advisory-only (prose in the structuring prompt a model could ignore) with
// no code-level visibility into whether it actually landed.
// scoreDeckAgainstIntent scores a structured outline against per-type
// expectations and returns warnings — it never rejects, retries, or mutates
// the outline. A "repair" pass that acts on a low score is a deliberately
// separate, riskier follow-up NOT built here — this is logging only.
//
// Ported verbatim from electron/slides/intent.js.

// Which slide TYPES a presentation type's framing prose leans on — used only
// for this visibility check, never as a validation/rejection rule.
// Deliberately loose (type OR its closest sibling counts) so this only fires
// when the nudge was seemingly ignored entirely, not whenever the mix merely
// leans a different direction than expected.
export const LEANED_TYPES_BY_PRESENTATION_TYPE = {
  "pitch-deck": ["stat_callout", "comparison", "timeline", "icon_grid", "icon_list", "table"],
  "sales": ["feature_split", "comparison", "stat_callout", "icon_grid", "icon_list", "table"],
  "university": ["bullets", "two_column", "icon_list", "process_steps"],
  "internal-report": ["stat_callout", "chart", "timeline", "icon_grid", "icon_list", "table", "process_steps"],
  "conference-talk": ["section_header", "quote", "icon_grid"],
  "minimal": ["bullets", "icon_list", "quote", "table"],
};

// Which slide ROLES (see outline.js's SLIDE_ROLES) a presentation type
// expects somewhere in the deck, and what role its closing slide should
// carry. Deliberately conservative — only the types/roles whose narrative
// arc is unambiguous get an entry, rather than guessing at every type.
// "content" is never listed: it's the default every slide falls back to, so
// requiring it would always trivially pass.
export const PRESENTATION_INTENT_RULES = {
  "pitch-deck": { requiredRoles: ["problem", "solution"], closingRole: "ask" },
  "sales": { requiredRoles: ["problem", "solution"], closingRole: "ask" },
  "university": { requiredRoles: [], closingRole: "conclusion" },
  "internal-report": { requiredRoles: [], closingRole: "next_steps" },
  "conference-talk": { requiredRoles: ["hook"], closingRole: null },
  "minimal": { requiredRoles: [], closingRole: null },
};

// Returns null when there's nothing to score against (no presentationType,
// or no rules/leaned-types entry for it, or an empty deck) — callers treat
// null as "skip, don't log". Otherwise { score: 0-1, warnings: string[] }.
export function scoreDeckAgainstIntent(outline, presentationType) {
  const rules = PRESENTATION_INTENT_RULES[presentationType];
  const leanedTypes = LEANED_TYPES_BY_PRESENTATION_TYPE[presentationType];
  if (!rules && !leanedTypes) return null;
  const slides = outline?.slides || [];
  if (slides.length === 0) return null;

  const checks = [];

  if (leanedTypes) {
    const usedTypes = new Set(slides.map((s) => s.type));
    checks.push({
      name: "leaned-type-usage",
      pass: leanedTypes.some((t) => usedTypes.has(t)),
      detail: `expected at least one of [${leanedTypes.join(", ")}], got [${[...usedTypes].join(", ")}]`,
    });
  }

  if (rules?.requiredRoles?.length) {
    const usedRoles = new Set(slides.map((s) => s.role));
    for (const role of rules.requiredRoles) {
      checks.push({
        name: `required-role:${role}`,
        pass: usedRoles.has(role),
        detail: `expected at least one slide with role "${role}", got roles [${[...usedRoles].join(", ")}]`,
      });
    }
  }

  if (rules?.closingRole) {
    const last = slides[slides.length - 1];
    checks.push({
      name: "closing-role",
      pass: last?.role === rules.closingRole,
      detail: `expected the last slide's role to be "${rules.closingRole}", got "${last?.role}"`,
    });
  }

  // Same "3+ consecutive same type" threshold as the structuring prompt's
  // own anti-monotony rule (see buildStructurePrompt) — this is the
  // code-side visibility check for how often that prompt-only rule actually
  // lands, not a separate/different rule.
  let maxRun = 1;
  let currentRun = 1;
  for (let i = 1; i < slides.length; i++) {
    currentRun = slides[i].type === slides[i - 1].type ? currentRun + 1 : 1;
    maxRun = Math.max(maxRun, currentRun);
  }
  checks.push({
    name: "type-diversity",
    pass: maxRun < 3,
    detail: `${maxRun} consecutive slides share the same type`,
  });

  const passed = checks.filter((c) => c.pass).length;
  const score = passed / checks.length;
  const warnings = checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`);

  return { score, warnings };
}
