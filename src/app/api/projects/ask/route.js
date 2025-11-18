import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { projectId, question } = body || {};

    if (!projectId || !question)
      return NextResponse.json({ error: "Missing projectId or question" }, { status: 400 });

    // verify project belongs to user
    const project = await prisma.project.findFirst({
      where: { id: projectId, user: { email: session.user.email } },
    });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    console.log("💬 Project ask:", projectId, question);

    // 1) Conversation (latest or new)
    let conv = await prisma.projectConversation.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    
    if (!conv) {
        const user = await prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true }
        });
      
        conv = await prisma.projectConversation.create({
          data: {
            projectId,
            userId: user.id,   // required by Prisma schema
          },
        });
      }

    // 2) Insert user message (pending)
    const userMsg = await prisma.projectMessage.create({
      data: {
        conversationId: conv.id,
        role: "user",
        content: question,
        status: "pending",
      },
    });

    // 3) Load ALL project documents (no selected filter)
    const docs = await prisma.document.findMany({
      where: { projectId },
    });

    if (!docs.length) {
      // mark user message done and return friendly text
      await prisma.projectMessage.update({
        where: { id: userMsg.id },
        data: { status: "done" },
      });
      return NextResponse.json({
        success: true,
        answer: "This project has no documents yet.",
      });
    }

    // 4) Load all chunks for those documents
    const docIds = docs.map((d) => d.id);
    const chunks = await prisma.chunk.findMany({
      where: { documentId: { in: docIds } },
    });

    const allChunks = chunks.map((c) => {
      const doc = docs.find((d) => d.id === c.documentId);
      return {
        id: c.id,
        documentId: c.documentId,
        documentName: doc?.filename || "untitled",
        chunkIndex: c.chunkIndex,
        text: c.summary || c.text || "",
        docSummary: doc?.summary || "",
        embedding: c.embedding, // Prisma Json field; either array or null
      };
    });

    // 5) Missing embeddings
    const missing = allChunks.filter((c) => !c.embedding && (c.text || "").trim().length > 0);

    // If lots missing, warm up in background and inform user
    if (missing.length > 10) {
      (async () => {
        try {
          for (const chunk of missing) {
            const embRes = await openai.embeddings.create({
              model: "text-embedding-3-small",
              input: chunk.text.slice(0, 8000),
            });
            const emb = embRes.data[0].embedding;
            await prisma.chunk.update({
              where: { id: chunk.id },
              data: { embedding: emb },
            });
          }
          console.log(`✅ Background embedding warm-up complete for project ${projectId}`);
        } catch (bgErr) {
          console.error("Background embedding generation failed:", bgErr);
        }
      })();

      return NextResponse.json({
        success: true,
        answer:
          "Preparing your project for the first time. I'm generating data in the background — please try again in a minute.",
      });
    }

    // 6) Inline embed small missing counts (≤10)
    if (missing.length > 0) {
      for (const chunk of missing) {
        const embRes = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: chunk.text.slice(0, 8000),
        });
        const emb = embRes.data[0].embedding;
        await prisma.chunk.update({
          where: { id: chunk.id },
          data: { embedding: emb },
        });
        chunk.embedding = emb;
      }
    }

    // 7) Embed question
    const qEmb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: question,
    });
    const queryEmbedding = qEmb.data[0].embedding;

    // 8) Similarity (cosine)
    const cosineSim = (a, b) => {
      const dot = a.reduce((s, x, i) => s + x * b[i], 0);
      const normA = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
      const normB = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
      if (normA === 0 || normB === 0) return 0;
      return dot / (normA * normB);
    };

    const scored = allChunks
      .filter((c) => c.embedding)
      .map((c) => ({ ...c, score: cosineSim(queryEmbedding, c.embedding) }))
      .sort((a, b) => b.score - a.score);

    const selected = scored.slice(0, Math.min(8, scored.length));

    // 9) Build context
    const grouped = selected.reduce((acc, s) => {
      acc[s.documentName] = acc[s.documentName] || [];
      acc[s.documentName].push(s);
      return acc;
    }, {});

    const contextBlocks = Object.entries(grouped).map(([docName, chunks]) => {
      const first = chunks[0];
      const docSummary = first.docSummary ? `Summary: ${first.docSummary}` : "";
      const chunkTexts = chunks
        .map(
          (s) => `- (Chunk ${s.chunkIndex}) ${String(s.text).slice(0, 600).replace(/\n+/g, " ")}`
        )
        .join("\n");
      return `Document: ${docName}\n${docSummary}\n${chunkTexts}`;
    });

    const docMeta = docs.map((d, i) => `${i + 1}. ${d.filename}`).join("\n");
    const context = `Project contains ${docs.length} documents:\n${docMeta}\n\n${contextBlocks.join("\n\n")}`;

    // 10) Short-term memory: previous messages (id < userMsg.id). Prisma IDs are strings (cuid),
    // but ordering by createdAt is safer.
    const prevMsgs = await prisma.projectMessage.findMany({
      where: { conversationId: conv.id, createdAt: { lt: userMsg.createdAt } },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
    prevMsgs.reverse();

    const systemMsg = {
      role: "system",
      content: `
You are an expert assistant answering questions about multiple documents within a project.
Use the provided document context and recent conversation history to stay consistent.
If a question refers to a previous answer, continue naturally and maintain coherence.
Respond in plain text only — absolutely no markdown, bold text, bullet points, lists, code blocks, or special formatting.
Be concise, factual, and rely strictly on the provided context without assumptions.
      `.trim(),
    };

    const memoryMsgs = prevMsgs.map((m) => ({ role: m.role, content: m.content }));
    const userMsgForModel = { role: "user", content: `Question: ${question}\n\nContext:\n${context}` };

    // 11) GPT call
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [systemMsg, ...memoryMsgs, userMsgForModel],
      temperature: 0.3,
      max_tokens: 800,
    });

    const assistantText = (completion?.choices?.[0]?.message?.content || "")
      .replace(/\*/g, "")
      .trim();

    // 12) Persist messages: update user -> done and insert assistant
    await prisma.projectMessage.update({
      where: { id: userMsg.id },
      data: { status: "done" },
    });

    await prisma.projectMessage.create({
      data: {
        conversationId: conv.id,
        role: "assistant",
        content: assistantText,
        status: "done",
      },
    });

    return NextResponse.json({ success: true, answer: assistantText });
  } catch (err) {
    console.error("❌ ask-project:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
