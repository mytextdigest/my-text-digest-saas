// src/lib/figureChunk.js
// Shared helper for building/refreshing a figure's synthetic retrieval Chunk.
// Used both by worker/processFigures.js (initial captioning) and the figures
// regenerate API route (re-captioning), so a regeneration updates the
// existing chunk in place instead of creating a duplicate.

export function buildFigureChunkText(caption, ocrText) {
  return `[Figure Analysis]\n${caption}\n\n[OCR Text]\n${ocrText || "(no text detected)"}`;
}

// `figure` needs: id, documentId, figureIndex, pageNumber, sourceType, chunkId
export async function upsertFigureChunk({ prisma, openai, figure, caption, ocrText }) {
  const text = buildFigureChunkText(caption, ocrText);

  const emb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8000),
  });
  const embedding = emb.data[0].embedding;

  if (figure.chunkId) {
    await prisma.chunk.update({
      where: { id: figure.chunkId },
      data: { text, embedding },
    });
    return figure.chunkId;
  }

  const chunk = await prisma.chunk.create({
    data: {
      documentId: figure.documentId,
      chunkIndex: 1_000_000 + figure.figureIndex,
      text,
      embedding,
      metadata: { figureId: figure.id, pageNumber: figure.pageNumber, sourceType: figure.sourceType },
    },
  });

  return chunk.id;
}
