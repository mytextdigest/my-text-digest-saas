// src/app/api/projects/ask/route.js
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { getUserOpenAIKey } from "@/utils/key_helper";
import { activeRequests } from "@/lib/requestCancellation";
import { detectChartIntent, generateChartSpec } from "@/lib/chartSpec";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Normalizes text for matching file names / user question
 */
function normalize(str = "") {
  return String(str || "")
    .toLowerCase()
    .normalize("NFKD") // fold accents
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/[^a-z0-9\s.-]/g, " ") // keep alphanum, dot, dash
    .replace(/\s+/g, " ")
    .trim();
}


const k1 = 1.5;
const b = 0.75;

function tokenize(text) {
  return normalize(text).split(" ").filter(w => w.length > 2);
}

function computeBM25(chunks, query) {
  const queryTokens = tokenize(query);
  const N = chunks.length;

  // Precompute avg document length
  const avgdl = chunks.reduce((s, c) => s + tokenize(c.text || "").length, 0) / N;

  // Precompute document frequencies DF(term)
  const df = {};
  for (const t of queryTokens) {
    df[t] = chunks.filter(c => tokenize(c.text || "").includes(t)).length || 0;
  }

  // IDF(term)
  const idf = {};
  for (const t of queryTokens) {
    const df_t = df[t];
    idf[t] = Math.log( (N - df_t + 0.5) / (df_t + 0.5) + 1 );
  }

  // BM25 score for each chunk
  const scores = chunks.map(chunk => {
    const tokens = tokenize(chunk.text || "");
    const dl = tokens.length;
    let score = 0;

    for (const t of queryTokens) {
      const tf = tokens.filter(x => x === t).length;
      if (tf === 0) continue;

      const denom = tf + k1 * (1 - b + b * (dl / avgdl));
      score += idf[t] * ((tf * (k1 + 1)) / denom);
    }

    return { ...chunk, score };
  });

  return scores.sort((a, b) => b.score - a.score);
}

export async function POST(req) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { projectId, question, requestId} = body || {};

    const controller = new AbortController();
    activeRequests.set(requestId, controller);

    req.signal?.addEventListener("abort", () => {
      controller.abort();
      activeRequests.delete(requestId);
    });

    if (!projectId || !question)
      return NextResponse.json({ error: "Missing projectId or question" }, { status: 400 });

    // verify project belongs to user
    const project = await prisma.project.findFirst({
      where: { id: projectId, user: { email: session.user.email } },
    });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    console.log("💬 Project ask:", projectId, question);


    const apiKey = await getUserOpenAIKey(session.user.id);

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_KEY_MISSING" },
        { status: 400 }
      );
    }

    const openai = new OpenAI({ apiKey });

    // Chart intent + optional topic-count data, shared by whichever GPT-reaching
    // branch below actually runs (BM25 fallback or the main embedding path).
    const wantsChart = detectChartIntent(question);
    let topicsExtraData = null;
    if (wantsChart && /topic|cluster|categor|group/i.test(question)) {
      topicsExtraData = await prisma.topic.findMany({
        where: { projectId },
        select: { id: true, name: true, documentCount: true },
        orderBy: { documentCount: "desc" },
      });
    }

    // 1) Conversation (latest or new)
    let conv = await prisma.projectConversation.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    if (!conv) {
      const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
      });

      conv = await prisma.projectConversation.create({
        data: {
          projectId,
          userId: user.id,
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

    // 🟡 Debug: selected vs unselected docs for mention detection
    const selectedDocsRaw = await prisma.document.findMany({
      where: { projectId, selected: 1 },
      select: { id: true, filename: true },
    });

    const unselectedDocsRaw = await prisma.document.findMany({
      where: { projectId, selected: 0 },
      select: { id: true, filename: true },
    });

    console.log("📄 Selected documents:", selectedDocsRaw);
    console.log("❌ Unselected documents:", unselectedDocsRaw);

    const q = normalize(question);

    // 1️⃣ Case: User explicitly says "unselected document"
    if (q.includes("unselected document")) {
      // mark user message done
      await prisma.projectMessage.update({
        where: { id: userMsg.id },
        data: { status: "done" },
      });
      return NextResponse.json({
        success: true,
        answer: "The document is unselected or does not exist, so I cannot answer that.",
      });
    }

    // 2️⃣ Extract names of unselected + selected docs mentioned in the question
    const mentionedUnselected = [];
    const mentionedSelected = [];

    for (const ud of unselectedDocsRaw) {
      if (q.includes(normalize(ud.filename))) {
        mentionedUnselected.push(ud.filename);
      }
    }

    for (const sd of selectedDocsRaw) {
      if (q.includes(normalize(sd.filename))) {
        mentionedSelected.push(sd.filename);
      }
    }

    // 3️⃣ If user mentions ONLY unselected docs → block
    if (mentionedUnselected.length > 0 && mentionedSelected.length === 0) {
      // mark user message done
      await prisma.projectMessage.update({
        where: { id: userMsg.id },
        data: { status: "done" },
      });

      if (mentionedUnselected.length === 1) {
        return NextResponse.json({
          success: true,
          answer: `The document "${mentionedUnselected[0]}" is unselected, so I cannot answer that.`,
        });
      } else {
        return NextResponse.json({
          success: true,
          answer: "The document is unselected or does not exist, so I cannot answer that.",
        });
      }
    }

    // 4) Load selected documents only (enforce selected filter)
    const docs = await prisma.document.findMany({
      where: { projectId, selected: 1 },
    });

    if (!docs.length) {
      await prisma.projectMessage.update({
        where: { id: userMsg.id },
        data: { status: "done" },
      });
      return NextResponse.json({
        success: true,
        answer: "No documents found in this project.",
      });
    }

    // 5) Load all chunks for selected documents
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
        text:  c.text || c.summary || "",
        docSummary: doc?.summary || "",
        embedding: c.embedding || null,
      };
    });

    // 6) Missing embeddings


    const docStatuses = docs.map(d => d.status);

    const allChunkedOrExtracting = docStatuses.every(s =>
      s === "chunked" || s === "extracting" || s === "pending"
    );

    const hasEmbeddingsReady = docStatuses.some(s =>
      s === "embedded" || s === "summarizing" || s === "ready"
    );

    console.log("📊 Document statuses:", docStatuses);

    if (allChunkedOrExtracting && !hasEmbeddingsReady) {
      console.log("🟦 BASIC CHAT (BM25): embeddings not ready");

      // BM25 scoring
      const scored = computeBM25(allChunks, question).slice(0, 8);

      const contextBlocks = scored
        .map(s => `Document: ${s.documentName}\n- ${s.text.slice(0, 600).replace(/\n+/g, " ")}`)
        .join("\n\n");

      let chartSpec = null;
      if (wantsChart) {
        chartSpec = await generateChartSpec({
          openai,
          question,
          contextText: contextBlocks,
          extraData: topicsExtraData,
          signal: controller.signal,
        });
      }
      const chartNote = !wantsChart
        ? ""
        : chartSpec
        ? `\nA ${chartSpec.type} chart has been generated from the project data and will be displayed to the user right below your answer. Do NOT say you are unable to create charts or visuals, and do not claim you can only provide text — instead briefly acknowledge the chart is shown below, and still give a concise text summary of the data.`
        : `\nA chart could not be generated from the available project data for this request. Briefly let the user know a visual isn't available this time, then answer with the information in text form.`;

      const systemMsg = {
        role: "system",
        content: `
You are answering based on extracted text only.
Embeddings are not ready yet.
Use ONLY the provided text. Do not invent facts.
BM25 retrieval has selected the most relevant chunks.
        `.trim() + chartNote,
      };

      // Load previous messages
      const prevMsgs = await prisma.projectMessage.findMany({
        where: { conversationId: conv.id, createdAt: { lt: userMsg.createdAt } },
        orderBy: { createdAt: "desc" },
        take: 6,
      });
      prevMsgs.reverse();

      const messages = [
        systemMsg,
        ...prevMsgs.map(m => ({ role: m.role, content: m.content })),
        {
          role: "user",
          content: `Question: ${question}\n\nContext:\n${contextBlocks}`,
        },
      ];

      console.log("🟦 Sending BM25 mode request to GPT");

      const completion = await openai.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages,
          temperature: 0.3,
          max_tokens: 800
        },
        {
          signal: controller.signal
        }
      );

      const assistantText = completion?.choices?.[0]?.message?.content?.trim() || "";

      // Store user & assistant messages
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
          chartData: chartSpec,
        },
      });

      return NextResponse.json({ success: true, answer: assistantText, chart: chartSpec });
    }



    const missing = allChunks.filter(c => !c.embedding);

    // 7) Inline embed small missing counts (≤10)
    if (missing.length > 0) {
      for (const chunk of missing) {
        if (controller.signal.aborted) {
          return NextResponse.json({ success: false, cancelled: true });
        }
        const embRes = await openai.embeddings.create(
          {
            model: "text-embedding-3-small",
            input: String(chunk.text).slice(0, 8000),
          },
          {
            signal: controller.signal
          }
        );
        const emb = embRes.data[0].embedding;
        await prisma.chunk.update({
          where: { id: chunk.id },
          data: { embedding: emb },
        });
        chunk.embedding = emb;
      }
    }

    // 8) Embed question
    const qEmb = await openai.embeddings.create(
      {
        model: "text-embedding-3-small",
        input: question,
      },
      {
        signal: controller.signal
      }
    );
    const queryEmbedding = qEmb.data[0].embedding;

    // 9) Similarity (cosine)
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

    // 10) Build context grouped by document
    const grouped = selected.reduce((acc, s) => {
      acc[s.documentName] = acc[s.documentName] || [];
      acc[s.documentName].push(s);
      return acc;
    }, {});

    const contextBlocks = Object.entries(grouped).map(([docName, chunks]) => {
      const first = chunks[0];
      const docSummary = first.docSummary ? `Summary: ${first.docSummary}` : "";
      const chunkTexts = chunks
        .map((s) => `- (Chunk ${s.chunkIndex}) ${String(s.text).slice(0, 600).replace(/\n+/g, " ")}`)
        .join("\n");
      return `Document: ${docName}\n${docSummary}\n${chunkTexts}`;
    });

    const docMeta = docs.map((d, i) => `${i + 1}. ${d.filename}`).join("\n");
    const context = `Project contains ${docs.length} documents:\n${docMeta}\n\n${contextBlocks.join("\n\n")}`;

    // 10.5) CHART GENERATION — runs BEFORE the main answer call so the answer
    // can react to whether a chart was actually produced (see chartNote below).
    let chartSpec = null;
    if (wantsChart) {
      chartSpec = await generateChartSpec({
        openai,
        question,
        contextText: context,
        extraData: topicsExtraData,
        signal: controller.signal,
      });
    }
    const chartNote = !wantsChart
      ? ""
      : chartSpec
      ? `\nA ${chartSpec.type} chart has been generated from the project data and will be displayed to the user right below your answer. Do NOT say you are unable to create charts or visuals, and do not claim you can only provide text — instead briefly acknowledge the chart is shown below, and still give a concise text summary of the data.`
      : `\nA chart could not be generated from the available project data for this request. Briefly let the user know a visual isn't available this time, then answer with the information in text form.`;

    // 11) Short-term memory: previous messages (createdAt < userMsg.createdAt)
    const prevMsgs = await prisma.projectMessage.findMany({
      where: { conversationId: conv.id, createdAt: { lt: userMsg.createdAt } },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
    prevMsgs.reverse();

    const systemMsg = {
      role: "system",
      content: `
You are an expert assistant that answers questions *based on selected project documents*.

You may:
- Summarize document content
- Explain document content
- Compare document content
- Generate new text (letters, emails, reports, etc.)
  as long as the factual information used comes from the selected documents.

Do NOT:
- Use information from unselected documents.
- Invent factual information that is not supported by the selected documents.

If a user asks about an unselected document:
"The document is unselected or does not exist, so I cannot answer that."

If a factual answer cannot be found in the selected documents:
"I cannot answer that based on the selected documents."

Response format:
- Plain text only (no markdown, no lists, no special formatting).
- When you refer to a specific document by name, quote its filename exactly as it
  appears after "Document:" in the context above (including the extension), so it can
  be linked back to the source.
      `.trim() + chartNote,
    };

    const memoryMsgs = prevMsgs.map((m) => ({ role: m.role, content: m.content }));
    const userMsgForModel = { role: "user", content: `Question: ${question}\n\nContext:\n${context}` };

    // 12) GPT call
    let completion;
    try {
      completion = await openai.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages: [systemMsg, ...memoryMsgs, userMsgForModel],
          temperature: 0.3,
          max_tokens: 800,
        },
        { signal: controller.signal }
      );
    } catch (err) {
      if (controller.signal.aborted) {
        console.log("🛑 project ask cancelled:", requestId);
        return NextResponse.json({ success: false, cancelled: true });
      }
      throw err;
    } finally {
      activeRequests.delete(requestId);
    }

    const assistantText = (completion?.choices?.[0]?.message?.content || "")
      .replace(/\*/g, "")
      .trim();

    // Citations: documents whose exact filename was quoted in the answer.
    // `allChunks` already carries { documentId, documentName } per chunk — dedupe to
    // one entry per document, then keep only the ones the model actually named.
    const uniqueDocs = new Map();
    for (const c of allChunks) {
      if (!uniqueDocs.has(c.documentId)) uniqueDocs.set(c.documentId, c.documentName);
    }
    const citations = [...uniqueDocs.entries()]
      .filter(([, filename]) => filename && assistantText.includes(filename))
      .map(([id, filename]) => ({ id, filename }));

    // 13) Persist messages: update user -> done and insert assistant
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
        chartData: chartSpec,
        citations: citations.length ? citations : undefined,
      },
    });

    return NextResponse.json({ success: true, answer: assistantText, chart: chartSpec, citations });
  } catch (err) {
    console.error("❌ ask-project:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
