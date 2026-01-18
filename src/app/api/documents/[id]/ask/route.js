import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { getUserOpenAIKey } from "@/utils/key_helper";

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req, { params }) {
  try {
    // ----------------------------
    // 1) AUTHENTICATION
    // ----------------------------
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id:documentId } = await params;
    const { question, conversationId: incomingConvId } = await req.json();

    if (!documentId || !question)
      return NextResponse.json({ error: "Missing params" }, { status: 400 });

    // ----------------------------
    // 2) DOCUMENT OWNERSHIP CHECK
    // ----------------------------
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        user: { email: session.user.email },
        selected: 1   // ← only include selected docs
      },
      include: { user: true }
    });

    if (!doc)
      return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const userId = doc.userId;

    const apiKey = await getUserOpenAIKey(userId);

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_KEY_MISSING" },
        { status: 400 }
      );
    }

    const openai = new OpenAI({ apiKey });

    // ----------------------------
    // 3) ENSURE CONVERSATION EXISTS
    // ----------------------------
    let conversationId = incomingConvId;

    if (conversationId) {
      const existingConv = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          documentId,
          userId
        }
      });

      if (!existingConv) conversationId = null;
    }

    if (!conversationId) {
      const newConv = await prisma.conversation.create({
        data: {
          documentId,
          userId
        }
      });
      conversationId = newConv.id;
    }

    // ----------------------------
    // 4) INSERT USER MESSAGE
    // ----------------------------
    const userMsg = await prisma.message.create({
      data: {
        conversationId,
        role: "user",
        content: question,
        status: "pending"
      }
    });

    // ----------------------------
    // 5) LOAD CHUNKS
    // ----------------------------
    const chunks = await prisma.chunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: "asc" }
    });

    const allChunks = chunks.map(c => ({
      id: c.id,
      chunkIndex: c.chunkIndex,
      text: c.text?.trim() || "",
      embedding: c.embedding
    }));

    // ----------------------------
    // 6) REGENERATE MISSING OR INVALID EMBEDDINGS
    // ----------------------------
    for (const chunk of allChunks) {
      if (!chunk.text) continue;

      let needsRegen = true;

      if (Array.isArray(chunk.embedding)) {
        const sumSquares = chunk.embedding.reduce((s, x) => s + x * x, 0);
        if (sumSquares > 1e-8) needsRegen = false;
      }

      if (needsRegen) {
        const embRes = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: chunk.text.slice(0, 8000)
        });

        const emb = embRes.data[0].embedding;

        await prisma.chunk.update({
          where: { id: chunk.id },
          data: { embedding: emb }
        });

        chunk.embedding = emb;
      }
    }

    // ----------------------------
    // 7) EMBED THE USER QUESTION
    // ----------------------------
    const questionEmbeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: `Provide information about: ${question}`
    });

    const queryEmbedding = questionEmbeddingRes.data[0].embedding;

    // ----------------------------
    // 8) COSINE SIMILARITY FUNCTION
    // ----------------------------
    const cosineSim = (a, b) => {
      const normA = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
      const normB = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
      if (normA === 0 || normB === 0) return 0;
      return a.reduce((sum, x, i) => sum + x * b[i], 0) / (normA * normB);
    };

    // ----------------------------
    // 9) RANK CHUNKS BY SIMILARITY
    // ----------------------------
    const scored = allChunks
      .filter(c => c.embedding && c.text.length > 0)
      .map(c => ({
        ...c,
        score: cosineSim(queryEmbedding, c.embedding)
      }))
      .sort((a, b) => b.score - a.score);

    let selected = scored.slice(0, Math.min(8, scored.length));

    if (selected.length === 0 && allChunks.length > 0) {
      selected = allChunks.slice(0, 8).map(c => ({ ...c, score: 0 }));
    }

    // ----------------------------
    // 10) BUILD CONTEXT FOR GPT
    // ----------------------------
    const contextText = selected
      .map(c => `Chunk ${c.chunkIndex}:\n${c.text}`)
      .join("\n\n");

    // ----------------------------
    // 11) SHORT-TERM MEMORY (LAST 6 MESSAGES)
    // ----------------------------
    const prevMsgs = await prisma.message.findMany({
      where: {
        conversationId,
        createdAt: { lt: userMsg.createdAt }
      },
      orderBy: { createdAt: "desc" },
      take: 6
    });

    prevMsgs.reverse();

    const systemMsg = {
      role: "system",
      content: `
        You are an expert assistant answering questions about a single document.
        You must use only the factual information contained in the provided document context.

        You may:
        - Summarize parts of the document
        - Explain concepts from the document
        - Rewrite or rephrase document content
        - Generate new text (letters, emails, reports, arguments, recommendations, proposals, essays, etc.)
          as long as all factual information comes strictly from the document context.

        Rules:
        - NEVER use information that is not present in the document context.
        - NEVER invent facts, numbers, names, or claims.
        - If the document does not fully answer the question, provide the closest accurate information the document contains (do not say "I don't know").
        - Plain text only (no markdown, no bullets, no special formatting).
        - Be concise, factual, and avoid assumptions.
      `.trim()
    };

    const memoryMsgs = prevMsgs.map(m => ({
      role: m.role,
      content: m.content
    }));

    const userMsgGPT = {
      role: "user",
      content: `Question: ${question}\n\nDocument Context:\n${contextText}`
    };

    // ----------------------------
    // 12) GPT CALL
    // ----------------------------
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [systemMsg, ...memoryMsgs, userMsgGPT],
        temperature: 0.2,
        max_tokens: 700
      });
    } catch (err) {
      console.error("OpenAI error:", err);

      await prisma.message.update({
        where: { id: userMsg.id },
        data: { status: "error" }
      });

      const errorMsg =
        "There was a problem contacting the AI model. Please try again later.";

      await prisma.message.create({
        data: {
          conversationId,
          role: "assistant",
          content: errorMsg,
          status: "error"
        }
      });

      return NextResponse.json({ success: false, error: errorMsg });
    }

    const assistantText =
      (completion?.choices?.[0]?.message?.content || "").trim();

    // ----------------------------
    // 13) SAVE ASSISTANT MESSAGE
    // ----------------------------
    await prisma.message.update({
      where: { id: userMsg.id },
      data: { status: "done" }
    });

    await prisma.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: assistantText,
        status: "done"
      }
    });

    // ----------------------------
    // 14) RETURN RESULT
    // ----------------------------
    return NextResponse.json({
      success: true,
      conversationId,
      answer: assistantText
    });

  } catch (err) {
    console.error("❌ ask-document error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
