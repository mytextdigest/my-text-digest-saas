import { prisma } from "@/lib/prisma";

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

export async function computeDocumentEmbedding(docId) {
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

function extractKeywordDistribution(text) {
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

  if (!text) return {};
  const tokens = text.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !STOPWORDS.has(w));
  if (!tokens.length) return {};
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
  const total = Object.values(freq).reduce((s, v) => s + v, 0);
  for (const k in freq) freq[k] /= total;
  return freq;
}

function unmergeKeywordDistribution(existing, outgoing, n) {
  if (n <= 1) return {};
  const newN = n - 1;
  const result = {};
  for (const w of Object.keys(existing || {})) {
    const val = ((existing[w] || 0) * n - (outgoing[w] || 0)) / newN;
    if (val > 0) result[w] = val;
  }
  return result;
}

function mergeKeywordDistributions(existing, incoming, n) {
  if (!existing || typeof existing !== "object") return incoming;
  const vocab = new Set([...Object.keys(existing), ...Object.keys(incoming)]);
  const merged = {};
  for (const w of vocab) {
    merged[w] = ((existing[w] || 0) * n + (incoming[w] || 0)) / (n + 1);
  }
  return merged;
}

// Remove a document's contribution from its topic centroid and keyword distribution.
// Deletes the topic if this was the last document.
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
    if (Array.isArray(oldCentroid) && oldCentroid.length === 1536 && docEmbedding) {
      newCentroid = oldCentroid.map((v, i) => (v * n - docEmbedding[i]) / newCount);
    }

    const newKeywords = unmergeKeywordDistribution(topic.keywordDistribution || {}, docKeywords || {}, n);

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

// Move a document from one topic to another (or to unassigned), updating both centroids.
export async function moveDocumentToTopic(docId, newTopicId) {
  // Get current topic assignment
  const existing = await prisma.topicDocument.findUnique({
    where: { documentId: docId },
    include: { topic: true },
  });

  // Get document embedding and keywords
  const docEmbedding = await computeDocumentEmbedding(docId);
  const docRecord = await prisma.document.findUnique({ where: { id: docId }, select: { content: true } });
  const docKeywords = extractKeywordDistribution(docRecord?.content || "");

  await prisma.$transaction(async (tx) => {
    // 1. Remove from old topic
    if (existing) {
      const oldTopic = existing.topic;
      if (oldTopic.documentCount <= 1) {
        await tx.topic.delete({ where: { id: oldTopic.id } });
      } else if (docEmbedding) {
        const n = oldTopic.documentCount;
        const newCount = n - 1;
        const oldCentroid = oldTopic.centroidEmbedding;
        const newCentroid = Array.isArray(oldCentroid) && oldCentroid.length === 1536
          ? oldCentroid.map((v, i) => (v * n - docEmbedding[i]) / newCount)
          : oldCentroid;
        const newKeywords = unmergeKeywordDistribution(oldTopic.keywordDistribution || {}, docKeywords, n);
        await tx.topic.update({
          where: { id: oldTopic.id },
          data: { centroidEmbedding: newCentroid, keywordDistribution: newKeywords, documentCount: newCount },
        });
      }
      await tx.topicDocument.delete({ where: { documentId: docId } });
    }

    if (!newTopicId) return; // unassign only

    // 2. Add to new topic
    const newTopic = await tx.topic.findUnique({ where: { id: newTopicId } });
    if (!newTopic) return;

    let newConfidence = 0;
    let newCentroid = docEmbedding || newTopic.centroidEmbedding;
    let newKeywords = mergeKeywordDistributions(newTopic.keywordDistribution, docKeywords, newTopic.documentCount);

    if (docEmbedding && Array.isArray(newTopic.centroidEmbedding) && newTopic.centroidEmbedding.length === 1536) {
      newConfidence = cosineSimilarity(docEmbedding, newTopic.centroidEmbedding);
      const n = newTopic.documentCount;
      newCentroid = newTopic.centroidEmbedding.map((v, i) => (v * n + docEmbedding[i]) / (n + 1));
    }

    await tx.topic.update({
      where: { id: newTopicId },
      data: {
        centroidEmbedding:   newCentroid,
        keywordDistribution: newKeywords,
        documentCount:       { increment: 1 },
      },
    });

    await tx.topicDocument.create({
      data: { topicId: newTopicId, documentId: docId, confidence: newConfidence },
    });
  });
}
