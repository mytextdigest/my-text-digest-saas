import { NextResponse } from "next/server";
import { activeRequests } from "@/lib/requestCancellation";

export async function POST(req) {
  const { requestId } = await req.json();

  const controller = activeRequests.get(requestId);
  if (controller) {
    controller.abort();
    activeRequests.delete(requestId);
    return NextResponse.json({ success: true, cancelled: true });
  }

  return NextResponse.json({ success: false });
}
