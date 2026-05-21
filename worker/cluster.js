import { PrismaClient } from "@prisma/client";
import { getOpenAIForDocument } from "./openai.js";

const prisma = new PrismaClient();

// Cosine similarity drives all threshold decisions.
// Bhattacharyya contributes a small secondary weight only.
const THRESHOLDS = {
  STRONG_MATCH: 0.75,
  WEAK_MATCH: 0.60,
};

const COSINE_WEIGHT        = 0.95;
const BHATTACHARYYA_WEIGHT = 0.05;

const STOPWORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with",
  "by","from","as","is","was","are","were","be","been","being","have",
  "has","had","do","does","did","will","would","could","should","may",
  "might","shall","can","not","no","nor","so","yet","both","either",
  "neither","each","few","more","most","other","some","such","than",
  "too","very","just","that","this","these","those","there","their",
  "they","them","what","which","who","whom","when","where","why","how",
  "all","any","both","each","more","also","into","about","after","before",
  "between","through","during","above","below","over","under","again",
  "further","then","once","here","only","own","same","than","up","out",
  "its","our","your","his","her","we","he","she","it","i","you","my",
  "me","us","him","his","her","hers","its","ours","yours","theirs",
]);

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function bhattacharyya(p, q) {
  const vocab = new Set([...Object.keys(p), ...Object.keys(q)]);
  let bc = 0;
  for (const word of vocab) {
    bc += Math.sqrt((p[word] || 0) * (q[word] || 0));
  }
  return bc;
}

function extractKeywordDistribution(text) {
  if (!text) return {};
  const tokens = text
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));

  if (!tokens.length) return {};

  const freq = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;

  const total = Object.values(freq).reduce((s, v) => s + v, 0);
  for (const k in freq) freq[k] /= total;
  return freq;
}

// Incremental keyword distribution merge: weight existing by n, new by 1
function mergeKeywordDistributions(existing, incoming, n) {
  if (!existing || typeof existing !== "object") return incoming;
  const vocab = new Set([...Object.keys(existing), ...Object.keys(incoming)]);
  const merged = {};
  for (const w of vocab) {
    merged[w] = ((existing[w] || 0) * n + (incoming[w] || 0)) / (n + 1);
  }
  return merged;
}

// Reverse-merge: subtract a document's keyword contribution from topic distribution
function unmergeKeywordDistribution(existing, outgoing, n) {
  if (n <= 1) return {};
  const newN = n - 1;
  const result = {};
  for (const w of Object.keys(existing)) {
    const val = ((existing[w] || 0) * n - (outgoing[w] || 0)) / newN;
    if (val > 0) result[w] = val;
  }
  return result;
}

function keywordFallbackName(text) {
  const freq = extractKeywordDistribution(text || "");
  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));
  return top.length ? top.join(" ") : "General Documents";
}

async function generateTopicName(documentContent, openai) {
  try {
    const sample = (documentContent || "").slice(0, 1500);
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a document categorization assistant. " +
            "Given a document excerpt, return ONLY a concise 2-3 word category name. " +
            "Examples: Financial Reports, Meeting Notes, Research Papers, Investor Decks, " +
            "Legal Contracts, Product Roadmaps. No explanation, no punctuation, just the name.",
        },
        { role: "user", content: `Document excerpt:\n${sample}` },
      ],
      max_tokens: 20,
      temperature: 0.3,
    });
    const name = res?.choices?.[0]?.message?.content?.trim();
    return name || keywordFallbackName(documentContent);
  } catch (err) {
    console.warn("⚠️  Topic name generation failed, using keyword fallback:", err.message);
    return keywordFallbackName(documentContent);
  }
}

async function computeDocumentEmbedding(docId) {
  const chunks = await prisma.chunk.findMany({
    where: { documentId: docId },
    select: { embedding: true },
  });

  const vectors = chunks
    .map(c => {
      const emb = c.embedding;
      if (!emb) return null;
      const arr = Array.isArray(emb) ? emb : (typeof emb === "string" ? JSON.parse(emb) : Object.values(emb));
      if (!Array.isArray(arr) || arr.length !== 1536) return null;
      return arr;
    })
    .filter(Boolean);

  if (!vectors.length) return null;

  const dim = 1536;
  const avg = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) avg[i] += v[i];
  }
  for (let i = 0; i < dim; i++) avg[i] /= vectors.length;
  return avg;
}

async function classifyDocument(docId, projectId, openai) {
  // 1. Document embedding (average of chunk embeddings)
  const docEmbedding = await computeDocumentEmbedding(docId);
  if (!docEmbedding) {
    console.warn(`⚠️  [${docId}] No embeddings found — skipping clustering`);
    return null;
  }

  // 2. Document keyword distribution (for Bhattacharyya auxiliary signal)
  const doc = await prisma.document.findUnique({ where: { id: docId }, select: { content: true } });
  const docContent = doc?.content || "";
  const docKeywords = extractKeywordDistribution(docContent);

  // 3. Existing topics for this project
  const topics = await prisma.topic.findMany({
    where: { projectId },
    orderBy: { documentCount: "desc" },
  });

  // 4. Score each topic
  let bestTopic  = null;
  let bestCosine = -Infinity;
  let bestBhatt  = 0;

  for (const topic of topics) {
    const centroid = topic.centroidEmbedding;
    if (!centroid || !Array.isArray(centroid) || centroid.length !== 1536) continue;

    const cosine = cosineSimilarity(docEmbedding, centroid);

    let bhattScore = 0;
    const topicKeywords = topic.keywordDistribution;
    if (
      Object.keys(docKeywords).length > 0 &&
      topicKeywords && typeof topicKeywords === "object" &&
      Object.keys(topicKeywords).length > 0
    ) {
      bhattScore = bhattacharyya(docKeywords, topicKeywords);
    }

    const blendedScore = COSINE_WEIGHT * cosine + BHATTACHARYYA_WEIGHT * bhattScore;

    console.log(
      `   📊 [${docId}] Topic "${topic.name}" — cosine: ${cosine.toFixed(4)}, ` +
      `bhatt: ${bhattScore.toFixed(4)}, blended: ${blendedScore.toFixed(4)}`
    );

    if (cosine > bestCosine) {
      bestCosine = cosine;
      bestBhatt  = bhattScore;
      bestTopic  = topic;
    }
  }

  // 5. Threshold decision (cosine only, not blended)
  const shouldCreateNew = topics.length === 0 || bestCosine < THRESHOLDS.WEAK_MATCH;

  if (shouldCreateNew) {
    // 5a. Create new topic
    const topicName = await generateTopicName(docContent, openai);
    console.log(`   🆕 [${docId}] Creating new topic: "${topicName}" (best cosine: ${bestCosine.toFixed(4)})`);

    const result = await prisma.$transaction(async (tx) => {
      const newTopic = await tx.topic.create({
        data: {
          projectId,
          name:                topicName,
          centroidEmbedding:   docEmbedding,
          keywordDistribution: docKeywords,
          documentCount:       1,
        },
      });
      await tx.topicDocument.create({
        data: { topicId: newTopic.id, documentId: docId, confidence: 0 },
      });
      return newTopic;
    });

    return { topicId: result.id, topicName, isNew: true, confidence: 0, bhattacharyyaScore: 0 };
  }

  // 5b. Assign to best matching topic
  console.log(`   ✅ [${docId}] Assigned to topic "${bestTopic.name}" (cosine: ${bestCosine.toFixed(4)})`);

  const n = bestTopic.documentCount;
  const oldCentroid = bestTopic.centroidEmbedding;
  const newCentroid = Array.isArray(oldCentroid)
    ? oldCentroid.map((v, i) => (v * n + docEmbedding[i]) / (n + 1))
    : docEmbedding;

  const newKeywords = mergeKeywordDistributions(bestTopic.keywordDistribution, docKeywords, n);

  await prisma.$transaction(async (tx) => {
    await tx.topic.update({
      where: { id: bestTopic.id },
      data: {
        centroidEmbedding:   newCentroid,
        keywordDistribution: newKeywords,
        documentCount:       { increment: 1 },
      },
    });
    await tx.topicDocument.upsert({
      where:  { documentId: docId },
      create: { topicId: bestTopic.id, documentId: docId, confidence: bestCosine },
      update: { topicId: bestTopic.id, confidence: bestCosine },
    });
  });

  return {
    topicId:            bestTopic.id,
    topicName:          bestTopic.name,
    isNew:              false,
    confidence:         bestCosine,
    bhattacharyyaScore: bestBhatt,
  };
}

// Called from API route when a document is removed from a topic (delete doc, unassign, or move)
export async function adjustTopicOnDocumentRemoval(topicId, docEmbedding, docKeywords) {
  await prisma.$transaction(async (tx) => {
    const topic = await tx.topic.findUnique({ where: { id: topicId } });
    if (!topic) return;

    if (topic.documentCount <= 1) {
      await tx.topic.delete({ where: { id: topicId } });
      return;
    }

    const n = topic.documentCount;
    const newCount = n - 1;
    const oldCentroid = topic.centroidEmbedding;

    let newCentroid = docEmbedding;
    if (Array.isArray(oldCentroid) && oldCentroid.length === 1536) {
      newCentroid = oldCentroid.map((v, i) => (v * n - docEmbedding[i]) / newCount);
    }

    const newKeywords = unmergeKeywordDistribution(
      topic.keywordDistribution || {},
      docKeywords || {},
      n
    );

    await tx.topic.update({
      where: { id: topicId },
      data: {
        centroidEmbedding:   newCentroid,
        keywordDistribution: newKeywords,
        documentCount:       newCount,
      },
    });
  });
}

export async function processClusterJobWorker(docId, projectId, recluster = false) {
  console.log(`🟪 CLUSTER JOB: ${docId} (recluster: ${recluster})`);

  // For recluster, doc is already `ready` — don't flip status back to clustering
  if (!recluster) {
    await prisma.document.update({
      where: { id: docId },
      data: { status: "clustering" },
    });
  }

  // Ensure we have projectId (may not be in old job messages)
  let resolvedProjectId = projectId;
  if (!resolvedProjectId) {
    const doc = await prisma.document.findUnique({ where: { id: docId }, select: { projectId: true } });
    resolvedProjectId = doc?.projectId;
  }

  if (!resolvedProjectId) {
    console.warn(`⚠️  [${docId}] No projectId found — skipping clustering`);
    await prisma.document.update({ where: { id: docId }, data: { status: "ready" } });
    return;
  }

  try {
    const openai = await getOpenAIForDocument(docId);
    const result = await classifyDocument(docId, resolvedProjectId, openai);

    if (!result) {
      console.warn(`⚠️  [${docId}] Clustering returned null — document left unassigned`);
    } else {
      console.log(
        `✅ [${docId}] Cluster complete: "${result.topicName}" ` +
        `(${result.isNew ? "new topic" : `cosine: ${result.confidence.toFixed(4)}`})`
      );
    }
  } catch (err) {
    console.error(`❌ [${docId}] Clustering failed:`, err.message);
    // Do not rethrow — clustering failure must not block the document from being usable
  } finally {
    await prisma.document.update({ where: { id: docId }, data: { status: "ready" } });
  }
}

export { computeDocumentEmbedding, extractKeywordDistribution };
