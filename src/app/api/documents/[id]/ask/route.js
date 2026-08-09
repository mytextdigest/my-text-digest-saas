import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getUserOpenAIKey } from "@/utils/key_helper";
import { activeRequests } from "@/lib/requestCancellation";
import { generateSignedUrl } from "@/lib/s3SignedUrl";
import s3Client from "@/lib/s3.mjs";
import { parseWorkbook, streamToBuffer } from "@/lib/spreadsheetParser";
import { detectChartIntent, generateChartSpec } from "@/lib/chartSpec";
import {
  GENERAL_KNOWLEDGE_TOOL,
  stashPendingToolCall,
} from "@/lib/generalKnowledgeTool";

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
    const { question, conversationId: incomingConvId, requestId } = await req.json();

    const controller = new AbortController();
    activeRequests.set(requestId, controller);

    req.signal?.addEventListener("abort", () => {
      controller.abort();
      activeRequests.delete(requestId);
    });

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
      if (controller.signal.aborted) {
        return NextResponse.json({ success: false, cancelled: true });
      }
      if (!chunk.text) continue;

      let needsRegen = true;

      if (Array.isArray(chunk.embedding)) {
        const sumSquares = chunk.embedding.reduce((s, x) => s + x * x, 0);
        if (sumSquares > 1e-8) needsRegen = false;
      }

      if (needsRegen) {
        const embRes = await openai.embeddings.create(
          {
            model: "text-embedding-3-small",
            input: chunk.text.slice(0, 8000)
          },
          {
            signal: controller.signal
          }
        );

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
    const questionEmbeddingRes = await openai.embeddings.create(
      {
        model: "text-embedding-3-small",
        input: `Provide information about: ${question}`
      },
      {
        signal: controller.signal
      }
    );

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
    // 10.5) CHART GENERATION — runs BEFORE the main answer call so the answer
    // can react to whether a chart was actually produced (see chartNote below).
    // ----------------------------
    const wantsChart = detectChartIntent(question);
    let chartSpec = null;

    if (wantsChart) {
      let extraData = null;

      const spreadsheetExts = ["xlsx", "xls", "csv"];
      const docExtForChart = doc.filename?.split(".").pop()?.toLowerCase();
      if (spreadsheetExts.includes(docExtForChart) && doc.filePath) {
        try {
          const object = await s3Client.send(
            new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: doc.filePath })
          );
          const buffer = await streamToBuffer(object.Body);
          const sheets = parseWorkbook(buffer, doc.filename);
          extraData = sheets.map((s) => ({
            sheet: s.name,
            headers: s.headers,
            rows: s.rows.slice(0, 200),
          }));
        } catch (err) {
          console.error("chart extraData spreadsheet fetch failed:", err);
        }
      }

      chartSpec = await generateChartSpec({
        openai,
        question,
        contextText,
        extraData,
        signal: controller.signal,
      });
    }

    const chartNote = !wantsChart
      ? ""
      : chartSpec
      ? `\nA ${chartSpec.type} chart has been generated from the document data and will be displayed to the user right below your answer. Do NOT say you are unable to create charts or visuals, and do not claim you can only provide text — instead briefly acknowledge the chart is shown below, and still give a concise text summary of the data.`
      : `\nA chart could not be generated from the available document data for this request. Briefly let the user know a visual isn't available this time, then answer with the information in text form.`;

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

STEP 0 — do this check FIRST, before drafting any answer:
Does fully answering this question require information that is NOT in the document context
below — e.g. another company's or product's data, current/live/today's data, industry or
market benchmarks, or general world knowledge the document doesn't cover?
- If YES: you MUST call the consult_general_knowledge tool with a precise, self-contained
  query for exactly that missing piece. Do this instead of answering. Do NOT say the
  document doesn't contain the information, do NOT give a partial answer, do NOT guess —
  call the tool. Example: "How does this margin compare to Tesla's?" -> call the tool with
  a query like "What is Tesla's most recent reported operating margin?".
- If NO (the question is fully within the document's own subject matter): continue to the
  rules below and answer from the document context.

If a consult_general_knowledge tool result already appears earlier in this conversation,
that content IS authorized outside information for this answer — use it directly to answer
the comparison, noting briefly that it comes from general knowledge and may not be fully
current. Do NOT refuse or redirect the user to look it up themselves once the tool has
already supplied an answer.

You must use only the factual information contained in the provided document context.

You may:
- Summarize parts of the document
- Explain concepts from the document
- Rewrite or rephrase document content
- Generate new text (letters, emails, reports, arguments, recommendations, proposals, essays, etc.)
  as long as all factual information comes strictly from the document context.

Rules (apply only once STEP 0 has determined the tool is NOT needed):
- NEVER use information that is not present in the document context.
- NEVER invent facts, numbers, names, or claims.
- If the document only partially covers an in-scope question, give the closest accurate
  information it contains rather than saying "I don't know" — this fallback does NOT apply
  when the missing piece is external/comparison data; that case is handled by STEP 0 above.
- Plain text only (no markdown, no bullets, no special formatting).
- Be concise, factual, and avoid assumptions.
      `.trim() + chartNote
    };

    const memoryMsgs = prevMsgs.map(m => ({
      role: m.role,
      content: m.content
    }));

    const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
    const docExt = doc.filename.split('.').pop().toLowerCase();
    const isImage = imageExts.includes(docExt) && doc.filePath;

    const userMsgGPT = {
      role: "user",
      content: isImage
        ? [
            { type: "text", text: `Question: ${question}\n\nDocument Context:\n${contextText}` },
            { type: "image_url", image_url: { url: await generateSignedUrl(doc.filePath), detail: "high" } },
          ]
        : `Question: ${question}\n\nDocument Context:\n${contextText}`,
    };

    // ----------------------------
    // 12) GPT CALL
    // ----------------------------
    let completion;
    try {
      completion = await openai.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages: [systemMsg, ...memoryMsgs, userMsgGPT],
          temperature: 0.2,
          max_tokens: 700,
          tools: [GENERAL_KNOWLEDGE_TOOL],
          tool_choice: "auto"
        },
        {
          signal: controller.signal
        }
      );
    } catch (err) {
      // 1. Cancellation is NOT an error
      if (controller.signal.aborted) {
        console.log("🛑 document ask cancelled:", requestId);
    
        // mark user message as done or cancelled (your choice)
        await prisma.message.update({
          where: { id: userMsg.id },
          data: { status: "done" } // or "cancelled" if you add that enum
        });
    
        return NextResponse.json({ success: false, cancelled: true });
      }
    
      // 2. Real error (quota, network, OpenAI failure, etc.)
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
    finally {
      activeRequests.delete(requestId);
    }

    // ----------------------------
    // 12.5) GENERAL-KNOWLEDGE TOOL CALL — never run silently; stash and ask
    // the user for confirmation instead of answering directly.
    // ----------------------------
    const toolCall = completion?.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.name === "consult_general_knowledge") {
      let query = "";
      try {
        query = JSON.parse(toolCall.function.arguments || "{}").query || "";
      } catch {
        query = "";
      }

      stashPendingToolCall(requestId, {
        kind: "document",
        conversationId,
        userMsgId: userMsg.id,
        baseMessages: [systemMsg, ...memoryMsgs, userMsgGPT],
        assistantMessage: completion.choices[0].message,
        toolCall,
        query,
        chartSpec,
        ownerUserEmail: session.user.email,
        apiKeyUserId: userId,
        completionOptions: { model: "gpt-4o-mini", temperature: 0.2, max_tokens: 700 }
      });

      return NextResponse.json({
        success: true,
        needsConfirmation: true,
        requestId,
        conversationId,
        query
      });
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
        status: "done",
        chartData: chartSpec
      }
    });

    // ----------------------------
    // 14) RETURN RESULT
    // ----------------------------
    return NextResponse.json({
      success: true,
      conversationId,
      answer: assistantText,
      chart: chartSpec
    });

  } catch (err) {
    console.error("❌ ask-document error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
