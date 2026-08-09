import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { getUserOpenAIKey } from "@/utils/key_helper";
import { activeRequests } from "@/lib/requestCancellation";
import { takePendingToolCall, resolveToolCall } from "@/lib/generalKnowledgeTool";

export async function POST(req) {
  const session = await getServerSession();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { requestId, approved } = await req.json();
  const pending = takePendingToolCall(requestId);

  if (!pending) {
    return NextResponse.json(
      { success: false, error: "No pending request found. It may have already been answered or cancelled." },
      { status: 404 }
    );
  }

  // SECURITY: verify the CURRENT session owns this pending request before doing
  // anything else — requestId is a client-generated, non-secret string, so
  // without this check any authenticated user who learned/guessed another
  // user's in-flight requestId could approve/decline that user's pending tool
  // call, running a completion billed to the other user's own OpenAI key and
  // returning that user's document/project answer content to the attacker.
  if (pending.ownerUserEmail !== session.user.email) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const apiKey = await getUserOpenAIKey(pending.apiKeyUserId);
  if (!apiKey) {
    return NextResponse.json({ success: false, error: "OPENAI_KEY_MISSING" }, { status: 400 });
  }
  const openai = new OpenAI({ apiKey });

  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  req.signal?.addEventListener("abort", () => {
    controller.abort();
    activeRequests.delete(requestId);
  });

  try {
    const { completion, externalKnowledgeQuery } = await resolveToolCall({
      openai,
      baseMessages: pending.baseMessages,
      assistantMessage: pending.assistantMessage,
      toolCall: pending.toolCall,
      approved,
      signal: controller.signal,
      completionOptions: pending.completionOptions,
    });

    const assistantText = (completion?.choices?.[0]?.message?.content || "").trim();

    if (pending.kind === "document") {
      await prisma.message.update({ where: { id: pending.userMsgId }, data: { status: "done" } });
      await prisma.message.create({
        data: {
          conversationId: pending.conversationId,
          role: "assistant",
          content: assistantText,
          status: "done",
          chartData: pending.chartSpec,
          externalKnowledgeQuery: externalKnowledgeQuery || null,
        },
      });
      return NextResponse.json({
        success: true,
        conversationId: pending.conversationId,
        answer: assistantText,
        chart: pending.chartSpec,
        externalKnowledgeQuery: externalKnowledgeQuery || null,
      });
    }

    // project — recompute citations the same way ask/route.js's main branch does
    const uniqueDocs = new Map();
    for (const c of pending.allChunksForCitations || []) {
      if (!uniqueDocs.has(c.documentId)) uniqueDocs.set(c.documentId, c.documentName);
    }
    const citations = [...uniqueDocs.entries()]
      .filter(([, filename]) => filename && assistantText.includes(filename))
      .map(([id, filename]) => ({ id, filename }));

    await prisma.projectMessage.update({ where: { id: pending.userMsgId }, data: { status: "done" } });
    await prisma.projectMessage.create({
      data: {
        conversationId: pending.conversationId,
        role: "assistant",
        content: assistantText,
        status: "done",
        chartData: pending.chartSpec,
        citations: citations.length ? citations : undefined,
        externalKnowledgeQuery: externalKnowledgeQuery || null,
      },
    });
    return NextResponse.json({
      success: true,
      answer: assistantText,
      chart: pending.chartSpec,
      citations,
      externalKnowledgeQuery: externalKnowledgeQuery || null,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      return NextResponse.json({ success: false, cancelled: true });
    }
    console.error("respond-general-knowledge error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  } finally {
    activeRequests.delete(requestId);
  }
}
