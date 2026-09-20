// src/lib/compareQueryTool.js
// Chat integration: a compare_documents tool for project chat's tool-use
// loop, alongside GENERAL_KNOWLEDGE_TOOL/QUERY_KNOWLEDGE_GRAPH_TOOL. Resolves
// free-text document names, reuses an existing ready comparison before
// regenerating (the main cost/latency control for the chat path), and hands
// the model a grounded plain-text summary to answer from.
//
// Unlike consult_general_knowledge, this runs inline with no confirmation
// gate — it only touches data the project already owns. Unlike the
// picker-driven flow (which enqueues a job and lets the frontend poll), the
// chat tool call needs a result *now*, within the same completion
// round-trip — so this polls DocumentComparison.status inline, bounded by a
// timeout, since the desktop version's synchronous-by-construction
// equivalent has no analogue in this queue-based architecture.
//
// Ported from the desktop app's electron/compare/queryTool.js.
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 45000;

export const COMPARE_DOCUMENTS_TOOL = {
  type: "function",
  function: {
    name: "compare_documents",
    description:
      "Compare two documents in this project and return a structured summary of what's the same, changed, added, or removed between them. Use when the user asks how two specific documents differ, or asks to compare/diff two documents by name.",
    parameters: {
      type: "object",
      properties: {
        document_a: { type: "string", description: "Filename (or a close match) of the first document" },
        document_b: { type: "string", description: "Filename (or a close match) of the second document" },
      },
      required: ["document_a", "document_b"],
    },
  },
};

function normalizeFilename(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Ambiguous (2+ plausible matches) or no-match resolves to a clarifying
// error the model relays to the user, rather than guessing — same grounding
// discipline as the classification pass, applied to document identity.
export function resolveDocumentName(query, documents) {
  const q = normalizeFilename(query);
  if (!q) return [];
  return documents.filter((d) => {
    const norm = normalizeFilename(d.filename);
    return norm.includes(q) || q.includes(norm);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runCompareDocumentsTool({ prisma, projectId, documentA, documentB }) {
  const documents = await prisma.document.findMany({
    where: { projectId },
    select: { id: true, filename: true },
  });

  const matchesA = resolveDocumentName(documentA, documents);
  const matchesB = resolveDocumentName(documentB, documents);

  if (matchesA.length === 0) return { error: `I couldn't find a document matching "${documentA}" in this project.` };
  if (matchesB.length === 0) return { error: `I couldn't find a document matching "${documentB}" in this project.` };
  if (matchesA.length > 1) {
    return { error: `More than one document matches "${documentA}" (${matchesA.map((d) => d.filename).join(", ")}) — ask the user which one they meant.` };
  }
  if (matchesB.length > 1) {
    return { error: `More than one document matches "${documentB}" (${matchesB.map((d) => d.filename).join(", ")}) — ask the user which one they meant.` };
  }

  const docA = matchesA[0];
  const docB = matchesB[0];
  if (docA.id === docB.id) {
    return { error: "Those both resolve to the same document — I need two different documents to compare." };
  }

  // Reuse-before-regenerate (decision 8) — only a "ready" row for this exact
  // unordered pair counts; an error/generating row is not reused, so a
  // previously failed chat-triggered comparison always gets a fresh attempt.
  const existing = await prisma.documentComparison.findFirst({
    where: {
      status: "ready",
      OR: [
        { documentAId: docA.id, documentBId: docB.id },
        { documentAId: docB.id, documentBId: docA.id },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  let comparisonId;
  if (existing) {
    comparisonId = existing.id;
  } else {
    const created = await prisma.documentComparison.create({
      data: { projectId, documentAId: docA.id, documentBId: docB.id, status: "generating" },
    });
    comparisonId = created.id;

    const sqs = new SQSClient({ region: process.env.AWS_REGION });
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.SQS_QUEUE_URL,
        MessageBody: JSON.stringify({
          type: "compare",
          comparisonId,
          documentAId: docA.id,
          documentBId: docB.id,
          projectId,
        }),
      })
    );

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let status = "generating";
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const row = await prisma.documentComparison.findUnique({
        where: { id: comparisonId },
        select: { status: true },
      });
      status = row?.status || "generating";
      if (status !== "generating") break;
    }

    if (status === "generating") {
      return {
        comparisonId,
        resultText: "The comparison is still generating — ask again in a moment and I'll have the result.",
      };
    }
    if (status === "error") {
      const errored = await prisma.documentComparison.findUnique({
        where: { id: comparisonId },
        select: { errorMessage: true },
      });
      return { error: `Comparison failed: ${errored?.errorMessage || "unknown error"}` };
    }
  }

  const comparison = await prisma.documentComparison.findUnique({
    where: { id: comparisonId },
    select: { summaryJson: true },
  });
  const summary = Array.isArray(comparison?.summaryJson) ? comparison.summaryJson : [];

  const resultText = summary.length
    ? summary.map((s) => `- [${s.category}] ${s.title}: ${s.explanation}`).join("\n")
    : "No significant differences or similarities were flagged.";

  return {
    comparisonId,
    resultText: `Comparison between "${docA.filename}" and "${docB.filename}":\n${resultText}`,
  };
}
