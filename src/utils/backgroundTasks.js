import OpenAI from "openai";
import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const limit = pLimit(5);

export async function generateEmbeddingsInBackground(docId, chunks) {
  console.log(`🧠 [${docId}] Starting embedding generation (${chunks.length} chunks)`);

  try {
    const tasks = chunks.map((chunk, idx) =>
      limit(async () => {
        if (!chunk?.trim()) return;

        const embeddingRes = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: chunk.slice(0, 8000),
        });

        const embedding = embeddingRes.data[0].embedding;
        await prisma.chunk.updateMany({
          where: { document_id: docId, chunk_index: idx },
          data: { embedding },
        });
      })
    );

    await Promise.all(tasks);
    console.log(`✅ [${docId}] All embeddings generated`);
  } catch (err) {
    console.error("❌ Embedding generation failed:", err.message);
  }
}

export async function runSummarizationInBackground(docId, filename, chunks) {
  console.log(`🟡 [${filename}] Starting summarization (${chunks.length} chunks)`);

  try {
    await prisma.document.update({
      where: { id: docId },
      data: { status: "summarizing" },
    });

    const summarizeChunk = async (chunkText) => {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a helpful assistant that summarizes text clearly and concisely." },
          { role: "user", content: `Summarize this:\n\n${chunkText}` },
        ],
        temperature: 0.3,
        max_tokens: 300,
      });
      return completion.choices[0].message.content.trim();
    };

    const summaries = await Promise.all(
      chunks.map((chunk) => limit(() => summarizeChunk(chunk)))
    );

    // Store summaries
    for (let i = 0; i < summaries.length; i++) {
      await prisma.chunk.updateMany({
        where: { document_id: docId, chunk_index: i },
        data: { summary: summaries[i] },
      });
    }

    // Final structured summary
    const joined = summaries.join("\n\n");
    const finalRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You create structured JSON summaries of documents." },
        {
          role: "user",
          content: `Based on these chunk summaries, produce valid JSON:
{
  "overview": "3–5 sentence summary",
  "keyPoints": ["point1", "point2", ...]
}

Chunk summaries:\n\n${joined}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    let structured;
    try {
      structured = JSON.parse(finalRes.choices[0].message.content.trim());
    } catch {
      structured = { overview: joined.slice(0, 1000), keyPoints: [] };
    }

    await prisma.document.update({
      where: { id: docId },
      data: {
        summary: structured,
        status: "ready",
      },
    });

    console.log(`✅ [${filename}] Summarization complete`);
  } catch (err) {
    console.error("❌ Summarization failed:", err);
    await prisma.document.update({
      where: { id: docId },
      data: { status: "error" },
    });
  }
}
