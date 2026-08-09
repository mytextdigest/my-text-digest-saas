import { NextResponse } from "next/server";
import { activeRequests } from "@/lib/requestCancellation";
import { takePendingToolCall } from "@/lib/generalKnowledgeTool";

export async function POST(req) {
  const { requestId } = await req.json();

  const controller = activeRequests.get(requestId);
  const discardedPending = !!takePendingToolCall(requestId);
  const cancelled = !!controller || discardedPending;

  if (controller) {
    controller.abort();
    activeRequests.delete(requestId);
  }

  return NextResponse.json({ success: cancelled, cancelled });
}
