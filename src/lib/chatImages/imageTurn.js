// src/lib/chatImages/imageTurn.js
// Ported from the desktop's electron/chat/imageTurn.js (CommonJS → ESM).
// Prompts, schemas, CHART_RULES and tolerances are unchanged — they were
// tuned on real charts; see docs/CHAT_IMAGE_ATTACHMENTS_FEATURE_SPEC.md.
//
// Image turns in chat: the user attached images this turn, or is following up
// on images from the last few messages ("now merge them into one graph").
//
// A planner call (vision) looks at the images and the request and
// picks a route BEFORE any document retrieval happens:
//   - generate_image → gpt-image-2 images.edit with the images as input
//   - answer_image   → a text answer read off the images
//   - documents      → not about the images; the normal RAG flow runs
// Document chunks only enter an image turn when the planner says the request
// explicitly needs them (use_documents), so retrieved text can't leak numbers
// into a redrawn chart or trigger the document-only refusals.
//
// The image model redraws everything from scratch, so for charts a second vision
// call transcribes the input charts' data (axes, ticks, series, values) into a
// fixed shape that goes into the image prompt with explicit accuracy rules.
// Asking the planner to do that in the same call didn't work — it reliably
// returned an empty list.
import { toFile } from "openai";
import { MODEL_IMAGE, MODEL_CHAT_VISION } from "../models.js";

const IMAGE_SIZES = new Set(["1536x1024", "1024x1024", "1024x1536"]);
const DEFAULT_IMAGE_SIZE = "1536x1024";
// The image model accepts up to 16 inputs; more than a handful just dilutes it.
const MAX_INPUT_IMAGES = 4;

const PLANNER_PROMPT = `You route one chat turn in a document-analysis app. The user attached images in this turn, or may be referring to images from earlier in the conversation. Every image is shown to you with a label.

route:
- "generate_image": the user wants an image produced or changed — combine, merge, redraw, put on a slide, restyle, convert a chart type, annotate, crop, recolour, etc.
- "answer_image": the user asks something about the image(s) that is answered in text.
- "documents": the message is not about these images at all. Never choose this when images were attached in this turn.
If the message refers to the images at all ("this chart", "the graph", "these", "it") — even while also asking about the documents — choose an image route and set use_documents. When images were attached in this turn and you are unsure, prefer an image route.

images: the numbers of the images this request is about, e.g. [1, 2]. On a follow-up, pick the images the user means — e.g. "merge them into one graph" after a slide was generated means the original charts (or the slide), not both.

use_documents: true ONLY if the request explicitly needs facts from the user's documents/reports (e.g. "compare this chart with what the report says", "add the Q3 numbers from the report"). Otherwise false.

image_prompt (generate_image only, else ""): instructions for an image model that receives the selected images as input, in the order of "images". Describe the OUTPUT: what it is, its layout, its title, and how each input is used. The data in the charts is transcribed separately and added for you — don't list values here.
- To combine images onto a slide: a clean 16:9 presentation slide, white background, a short title, the items arranged side by side at equal size, filling the slide with balanced margins and no large empty areas.
- To merge charts into one: a single chart, one shared x-axis, a distinct colour per series, a legend naming each series. When units or magnitudes differ a lot, use a secondary y-axis and say which series goes on which axis; when they are comparable, use one axis.
- To restyle or convert a chart: say exactly what changes and that everything else stays the same.

lead_in (generate_image only, else ""): 1–3 friendly first-person sentences said before the image appears, describing what you're making and how — layout, which series go where, how differing scales are handled. Do not say it is finished. No headings or bullet lists.

size: "1536x1024" for slides and most charts, "1024x1024" for square content, "1024x1536" for tall content.`;

const PLAN_SCHEMA = {
  name: "image_turn_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["route", "images", "use_documents", "image_prompt", "lead_in", "size"],
    properties: {
      route: { type: "string", enum: ["generate_image", "answer_image", "documents"] },
      images: { type: "array", items: { type: "integer" } },
      use_documents: { type: "boolean" },
      image_prompt: { type: "string" },
      lead_in: { type: "string" },
      size: { type: "string", enum: ["1536x1024", "1024x1024", "1024x1536"] },
    },
  },
};

const TRANSCRIBE_PROMPT = `Transcribe every chart or graph in these images exactly, so it can be redrawn without looking at the image. One entry per chart (an image may hold several; a photo or diagram with no chart gets none).
- Copy titles, axis titles (with units), category labels, legend names and printed numbers exactly as shown.
- y_axes: each value axis with its min, max and tick values as printed.
- series values: one per category, in category order; use the printed data label when there is one, otherwise read it off the gridlines; null when a category has no value.
- colour: a plain colour name or hex.
- notes: anything else visible that a faithful redraw must keep (annotations, footnotes, reference lines); "" if none.`;

const CHARTS_SCHEMA = {
  name: "chart_transcription",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["charts"],
    properties: {
      charts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["image", "title", "type", "x_axis", "y_axes", "series", "notes"],
          properties: {
            image: { type: "integer" },
            title: { type: "string" },
            type: { type: "string" },
            x_axis: {
              type: "object",
              additionalProperties: false,
              required: ["title", "categories"],
              properties: { title: { type: "string" }, categories: { type: "array", items: { type: "string" } } },
            },
            y_axes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["side", "title", "min", "max", "ticks"],
                properties: {
                  side: { type: "string", enum: ["left", "right"] },
                  title: { type: "string" },
                  min: { type: "number" },
                  max: { type: "number" },
                  ticks: { type: "array", items: { type: "number" } },
                },
              },
            },
            series: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "y_axis", "colour", "values"],
                properties: {
                  name: { type: "string" },
                  y_axis: { type: "string", enum: ["left", "right"] },
                  colour: { type: "string" },
                  values: { type: "array", items: { type: ["number", "null"] } },
                },
              },
            },
            notes: { type: "string" },
          },
        },
      },
    },
  },
};

const CHART_RULES = `CHART ACCURACY RULES:
- Use exactly the data above. Do not add, drop, round or change any value, category or label.
- A chart that keeps its original axes uses exactly the listed range and tick values. A merged or converted chart uses, for each y-axis, a range that starts at 0 (unless the data is negative) and ends at a round number at or above the largest value on that axis, with 5–6 evenly spaced round ticks.
- Bar heights and point positions must be proportional to their values on their own axis — a value of 47 on a 0–50 axis reaches 94% of the axis height.
- Spell every title, axis title, category, legend entry and number exactly as given. Text is horizontal except y-axis titles, crisp and legible.
- Flat, clean, professional style on a white background; no 3D, shadows, decorations or watermarks.`;

function imagePart(img, detail = "high") {
  return { type: "image_url", image_url: { url: `data:${img.mime};base64,${img.buffer.toString("base64")}`, detail } };
}

function labelFor(img, idx) {
  const where = img.isCurrent
    ? "attached by the user in this message"
    : img.direction === "output" ? "generated by you earlier in this conversation" : "attached by the user earlier in this conversation";
  return `Image ${idx + 1} (${where}${img.name ? `, "${img.name}"` : ""}):`;
}

function historyText(history) {
  if (!history.length) return "";
  const lines = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${String(m.content || "").slice(0, 600)}`);
  return `Recent conversation:\n${lines.join("\n")}\n\n`;
}

function parseJson(res) {
  try { return JSON.parse(res.choices[0].message.content || "{}"); } catch (e) { return {}; }
}

// images: [{ buffer, mime, name, direction, isCurrent }]
async function planImageTurn({ openai, question, images, history = [], signal }) {
  const content = [{ type: "text", text: `${historyText(history)}User's message: ${question}` }];
  images.forEach((img, idx) => {
    content.push({ type: "text", text: labelFor(img, idx) });
    content.push(imagePart(img));
  });

  const res = await openai.chat.completions.create({
    model: MODEL_CHAT_VISION,
    temperature: 0.2,
    max_tokens: 1200,
    response_format: { type: "json_schema", json_schema: PLAN_SCHEMA },
    messages: [{ role: "system", content: PLANNER_PROMPT }, { role: "user", content }],
  }, { signal });
  const plan = parseJson(res);

  const hasCurrent = images.some((img) => img.isCurrent);
  let route = ["generate_image", "answer_image", "documents"].includes(plan.route) ? plan.route : null;
  if (!route) route = hasCurrent ? "answer_image" : "documents";
  if (route === "documents" && hasCurrent) route = "answer_image";
  if (route === "generate_image" && !String(plan.image_prompt || "").trim()) route = "answer_image";

  const picked = (Array.isArray(plan.images) ? plan.images : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= images.length);
  const imageIndices = (picked.length ? [...new Set(picked)] : images.map((_, i) => i + 1))
    .slice(0, MAX_INPUT_IMAGES)
    .map((n) => n - 1);

  return {
    route,
    imageIndices,
    useDocuments: !!plan.use_documents,
    leadIn: String(plan.lead_in || "").trim(),
    imagePrompt: String(plan.image_prompt || "").trim(),
    size: IMAGE_SIZES.has(plan.size) ? plan.size : DEFAULT_IMAGE_SIZE,
  };
}

async function transcribeCharts({ openai, images, signal }) {
  const content = [];
  images.forEach((img, idx) => {
    content.push({ type: "text", text: `Image ${idx + 1}:` });
    content.push(imagePart(img));
  });
  const res = await openai.chat.completions.create({
    model: MODEL_CHAT_VISION,
    temperature: 0,
    max_tokens: 3000,
    response_format: { type: "json_schema", json_schema: CHARTS_SCHEMA },
    messages: [{ role: "system", content: TRANSCRIBE_PROMPT }, { role: "user", content }],
  }, { signal });
  const charts = parseJson(res).charts;
  return Array.isArray(charts) ? charts.filter((c) => c && Array.isArray(c.series) && c.series.length) : [];
}

function formatChart(chart) {
  const lines = [`Input image ${chart.image}: "${chart.title || "Untitled"}" (${chart.type || "chart"})`];
  const cats = chart.x_axis?.categories || [];
  lines.push(`  x-axis${chart.x_axis?.title ? ` "${chart.x_axis.title}"` : ""}: ${cats.map((c) => `"${c}"`).join(", ")}`);
  for (const axis of chart.y_axes || []) {
    const ticks = axis.ticks?.length ? `, ticks ${axis.ticks.join(", ")}` : "";
    lines.push(`  ${axis.side} y-axis "${axis.title}": ${axis.min} to ${axis.max}${ticks}`);
  }
  for (const series of chart.series) {
    const pairs = (series.values || []).map((v, i) => `${cats[i] ?? i + 1} = ${v ?? "—"}`).join("; ");
    lines.push(`  series "${series.name || chart.title}"${series.colour ? ` (${series.colour})` : ""}: ${pairs}`);
  }
  if (chart.notes) lines.push(`  keep: ${chart.notes}`);
  return lines.join("\n");
}

// The planner's description of the output, plus the transcribed source data
// and accuracy rules when the inputs contain charts. Returns the charts too —
// generateCheckedImage verifies the output against them.
async function buildImagePrompt({ openai, imagePrompt, images, signal }) {
  let charts = [];
  try {
    charts = await transcribeCharts({ openai, images, signal });
  } catch (err) {
    if (signal?.aborted || err.name === "AbortError") throw err;
    console.warn("Chart transcription failed — generating without it:", err.message);
  }
  if (!charts.length) return { prompt: imagePrompt, charts };
  return {
    prompt: `${imagePrompt}\n\nSOURCE DATA read from the input images (reproduce exactly):\n${charts.map(formatChart).join("\n\n")}\n\n${CHART_RULES}`,
    charts,
  };
}

function dataPoints(charts) {
  const points = [];
  for (const chart of charts) {
    const cats = chart.x_axis?.categories || [];
    const axisMax = Math.max(...(chart.y_axes || []).map((a) => Math.abs(a.max) || 0), 0);
    for (const series of chart.series || []) {
      (series.values || []).forEach((v, i) => {
        if (typeof v !== "number") return;
        points.push({ value: v, label: `${series.name || chart.title} ${cats[i] ?? ""} = ${v}`.replace(/\s+/g, " ").trim(), axisMax });
      });
    }
  }
  return points;
}

// Source data points with no match among the output's points. Values read
// off gridlines are approximate, hence the tolerance.
function missingPoints(sourceCharts, outputCharts) {
  const available = dataPoints(outputCharts).map((p) => p.value);
  const missing = [];
  for (const point of dataPoints(sourceCharts)) {
    const tol = Math.max(Math.abs(point.value) * 0.03, point.axisMax * 0.015, 1e-9);
    const idx = available.findIndex((v) => Math.abs(v - point.value) <= tol);
    if (idx === -1) missing.push(point.label);
    else available.splice(idx, 1);
  }
  return missing;
}

// Generates the image and, when the inputs had charts, reads the result back
// and compares every source data point. The first attempt is low quality —
// with the source data spelled out it drew charts as accurately as high
// quality in testing, at ~1/35 the output cost and ~1/5 the time. If the
// check finds a dropped or changed value, one corrected retry runs at medium
// quality, and the better of the two attempts is kept. Returns
// { buffer, quality } — the quality of the attempt that was kept.
async function generateCheckedImage({ openai, images, prompt, charts = [], size, signal, onStatus }) {
  // Without chart data there's nothing to check against, so a single
  // medium-quality attempt is the safer default.
  if (!charts.length) {
    return { buffer: await generateImageFromImages({ openai, images, prompt, size, quality: "medium", signal }), quality: "medium" };
  }
  const buffer = await generateImageFromImages({ openai, images, prompt, size, quality: "low", signal });

  const check = async (buf) => {
    try {
      const out = await transcribeCharts({ openai, images: [{ buffer: buf, mime: "image/png" }], signal });
      return missingPoints(charts, out);
    } catch (err) {
      if (signal?.aborted || err.name === "AbortError") throw err;
      return [];
    }
  };

  onStatus?.("Checking the chart against the source data…");
  const missing = await check(buffer);
  if (!missing.length) return { buffer, quality: "low" };

  console.log(`🖼️ Generated image is missing ${missing.length} data point(s): ${missing.join("; ")} — retrying once`);
  onStatus?.("Fixing a data mismatch and redrawing…");
  const retryPrompt = `${prompt}\n\nIMPORTANT — a previous attempt got these data points wrong or left them out. Every one of them must be drawn, at the correct height, with its label: ${missing.join("; ")}.`;
  const retry = await generateImageFromImages({ openai, images, prompt: retryPrompt, size, quality: "medium", signal });
  onStatus?.("Checking the chart against the source data…");
  const retryMissing = await check(retry);
  return retryMissing.length <= missing.length ? { buffer: retry, quality: "medium" } : { buffer, quality: "low" };
}

// Folds document facts into the image prompt when the planner said the
// request needs them — the image model gets a short fact list, not raw chunks.
async function addDocumentFactsToPrompt({ openai, imagePrompt, question, documentContext, signal }) {
  if (!documentContext) return imagePrompt;
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `From the document excerpts below, list at most 8 short facts (with exact numbers and units) that this image request needs. Only facts stated in the excerpts. If none are relevant, reply "NONE".\n\nRequest: ${question}\n\nExcerpts:\n${documentContext.slice(0, 12000)}`,
    }],
  }, { signal });
  const facts = (res.choices[0].message.content || "").trim();
  if (!facts || /^none\.?$/i.test(facts)) return imagePrompt;
  return `${imagePrompt}\n\nFacts from the user's documents to include exactly as written:\n${facts}`;
}

async function generateImageFromImages({ openai, images, prompt, size, quality = "medium", signal }) {
  const files = await Promise.all(images.map((img, i) => toFile(img.buffer, `input-${i + 1}.png`, { type: img.mime })));
  const response = await openai.images.edit({
    model: MODEL_IMAGE,
    image: files,
    prompt,
    size: IMAGE_SIZES.has(size) ? size : DEFAULT_IMAGE_SIZE,
    // Output cost per 1536x1024 image: low ≈ $0.005, medium ≈ $0.04,
    // high ≈ $0.16. No input_fidelity: gpt-image-2 rejects it (it always
    // uses high fidelity).
    quality,
    n: 1,
  }, { signal });
  const b64 = response?.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image generation returned no data");
  return Buffer.from(b64, "base64");
}

async function answerAboutImages({ openai, question, images, history = [], documentContext = "", signal }) {
  const system = `You answer questions about images the user shared in a document-analysis app. Base your answer on what is visible in the images. When reading values off a chart, say they are read from the image and approximate where the chart doesn't label them. ${documentContext ? "Document excerpts are also provided; use them only where the question asks about the documents, and keep image values and document values clearly separate." : "Do not bring in outside facts."} Use light markdown where it helps; keep it concise.`;
  const content = [{ type: "text", text: `Question: ${question}` }];
  images.forEach((img, idx) => {
    content.push({ type: "text", text: labelFor(img, idx) });
    content.push(imagePart(img));
  });
  if (documentContext) content.push({ type: "text", text: `Document excerpts (secondary context):\n${documentContext.slice(0, 12000)}` });

  const res = await openai.chat.completions.create({
    model: MODEL_CHAT_VISION,
    temperature: 0.2,
    max_tokens: 900,
    messages: [
      { role: "system", content: system },
      ...history.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.content || "") })),
      { role: "user", content },
    ],
  }, { signal });
  return (res.choices[0].message.content || "").trim();
}

function friendlyImageError(err) {
  const msg = String(err?.message || err || "");
  if (/verif/i.test(msg) && /organi[sz]ation/i.test(msg)) {
    return `Image generation needs a verified OpenAI organization for ${MODEL_IMAGE}. Verify your organization in the OpenAI dashboard, then try again.`;
  }
  if (/safety|moderation|rejected/i.test(msg)) return "The image request was blocked by OpenAI's safety system. Try rephrasing it.";
  return `I couldn't generate the image: ${msg || "unknown error"}`;
}

export {
  planImageTurn,
  buildImagePrompt,
  generateCheckedImage,
  addDocumentFactsToPrompt,
  generateImageFromImages,
  answerAboutImages,
  friendlyImageError,
  MAX_INPUT_IMAGES,
};
