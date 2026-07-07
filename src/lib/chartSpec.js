const CHART_TYPES = ["bar", "line", "area", "pie", "scatter"];
const MAX_CATEGORIES = 50;
const MAX_SERIES = 6;
const MAX_TITLE_LEN = 120;
const MAX_AXIS_LABEL_LEN = 60;

const CHART_TRIGGERS = [
  "chart", "graph", "plot", "visualiz", "visualis",
  "pie chart", "bar chart", "line chart", "trend",
  "breakdown", "distribution", "compare", "over time",
];

export function detectChartIntent(question) {
  if (!question) return false;
  const q = question.toLowerCase();
  return CHART_TRIGGERS.some((word) => q.includes(word));
}

const SYSTEM_PROMPT = `You are a data-visualization assistant. Given a user's question and the provided context, decide whether a chart would help answer it, and if so, emit a single JSON object with exactly this shape:

{"chart": {"type": "bar" | "line" | "area" | "pie" | "scatter", "title": string, "xAxisLabel"?: string, "yAxisLabel"?: string, "categories": string[], "series": [{"name": string, "data": number[]}]}}

If a chart is not appropriate, or the context doesn't contain enough concrete numeric data to support one, return exactly {"chart": null}.

Rules:
- Only use numbers explicitly present in the provided context or data — never invent values.
- COMPLETENESS IS MANDATORY: if the context contains a list or breakdown relevant to the question (e.g. a set of budget percentages, categories, or line items), you MUST include EVERY item from that list as its own category/data point. Never silently drop, sample, or summarize down to a subset of a complete list that is present in the context — a partial chart is worse than no chart. Only omit items if there are more than 50 (the category cap below).
- "categories" is REQUIRED and must have exactly one label per data point, in the same order as each series' "data" array — this applies to EVERY type, including "pie": for a pie chart, "categories" holds the slice labels (e.g. ["Engineering", "Marketing"]) and "series" has exactly one entry whose "data" holds the matching slice values (e.g. [34, 18]). Never leave "categories" empty for a non-scatter chart.
- For "scatter" only, each series' "data" must be [{"x": number, "y": number}, ...] instead, and "categories" is omitted.
- Use at most 6 series and 50 categories.
- Respond with raw JSON only — no markdown, no code fences, no commentary.

Example for a pie chart: {"chart": {"type": "pie", "title": "Budget by Department", "categories": ["Engineering", "Marketing", "Support"], "series": [{"name": "Budget", "data": [34, 22, 18]}]}}`;

// Document chunks can be up to ~12,000 chars each (see worker/index.js) and the
// ask routes pass up to 8 of them — truncating much below that risks cutting a
// single chunk (and the data point it holds) mid-way. gpt-4o-mini's context
// window comfortably fits the full worst case, so these caps are just a safety
// ceiling, not a real constraint for normal documents.
const MAX_CONTEXT_CHARS = 100_000;
const MAX_EXTRA_DATA_CHARS = 40_000;

export function buildChartPrompt({ question, contextText, extraData }) {
  const system = { role: "system", content: SYSTEM_PROMPT };

  const extraBlock = extraData
    ? `\n\nPrecise data (prefer these exact numbers over anything else in the context below):\n${JSON.stringify(extraData).slice(0, MAX_EXTRA_DATA_CHARS)}`
    : "";

  const user = {
    role: "user",
    content: `Question: ${question}\n\nContext:\n${(contextText || "").slice(0, MAX_CONTEXT_CHARS)}${extraBlock}`,
  };

  return { system, user };
}

function truncateStr(s, maxLen) {
  if (typeof s !== "string") return undefined;
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function toFiniteOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Never throws — any problem (bad JSON, bad type, empty data) degrades to null
// so a malformed/hallucinated chart response can never break the chat answer.
export function validateChartSpec(rawJsonString, fallbackTitle) {
  try {
    if (!rawJsonString) return null;

    const parsed = JSON.parse(rawJsonString);
    const chart = parsed?.chart;
    if (chart === null || chart === undefined || typeof chart !== "object") return null;

    const type = CHART_TYPES.includes(chart.type) ? chart.type : null;
    if (!type) return null;

    const title =
      truncateStr(chart.title, MAX_TITLE_LEN) ||
      truncateStr(fallbackTitle, MAX_TITLE_LEN) ||
      "Chart";

    const rawSeries = Array.isArray(chart.series) ? chart.series.slice(0, MAX_SERIES) : [];

    if (type === "scatter") {
      const series = rawSeries
        .map((s) => {
          const name = truncateStr(s?.name, MAX_TITLE_LEN) || "Series";
          const points = Array.isArray(s?.data) ? s.data : [];
          // Points aren't positionally parallel to anything else, so dropping
          // an individual invalid {x,y} pair (rather than nulling it) is safe here.
          const data = points
            .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
            .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
          return { name, data };
        })
        .filter((s) => s.data.length > 0);

      if (series.length === 0) return null;

      return { type, title, series };
    }

    const xAxisLabel = truncateStr(chart.xAxisLabel, MAX_AXIS_LABEL_LEN);
    const yAxisLabel = truncateStr(chart.yAxisLabel, MAX_AXIS_LABEL_LEN);

    const categories = Array.isArray(chart.categories)
      ? chart.categories.slice(0, MAX_CATEGORIES).map((c) => {
          const s = String(c ?? "").trim();
          return s || "—";
        })
      : [];

    if (categories.length === 0) return null;

    const series = rawSeries
      .map((s) => {
        const name = truncateStr(s?.name, MAX_TITLE_LEN) || "Series";
        const rawData = Array.isArray(s?.data) ? s.data : [];
        // Map non-finite values to null IN PLACE (never filter/drop) — dropping
        // an entry mid-array would shift every subsequent value out of alignment
        // with `categories`. `null` renders as a gap in Recharts, which is correct.
        const data = categories.map((_, i) => toFiniteOrNull(rawData[i]));
        return { name, data };
      })
      // Only drop a whole series if every value in it is null.
      .filter((s) => s.data.some((v) => v !== null));

    if (series.length === 0) return null;

    return { type, title, xAxisLabel, yAxisLabel, categories, series };
  } catch {
    return null;
  }
}

// Orchestrates: build prompt -> one OpenAI call -> validate -> normalized spec or null.
// Never throws — catches everything internally so a chart failure can never break the chat answer.
export async function generateChartSpec({ openai, question, contextText, extraData, signal }) {
  try {
    const { system, user } = buildChartPrompt({ question, contextText, extraData });

    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [system, user],
        temperature: 0.1,
        max_tokens: 700,
        response_format: { type: "json_object" },
      },
      { signal }
    );

    const content = completion?.choices?.[0]?.message?.content || "";
    const spec = validateChartSpec(content, question);

    if (!spec) {
      console.warn("generateChartSpec: no chart after validation, raw model output:", content);
    }

    return spec;
  } catch (err) {
    if (err?.name === "AbortError" || signal?.aborted) return null;
    console.error("generateChartSpec error:", err);
    return null;
  }
}
