import OpenAI from "openai";
import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { apiKey } = await req.json();

    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json(
        { valid: false, error: "API key is required" },
        { status: 400 }
      );
    }

    // Same logic as desktop IPC
    const client = new OpenAI({ apiKey });

    // Cheap validation call
    await client.models.list();

    return NextResponse.json({ valid: true });
  } catch (err) {
    return NextResponse.json(
      {
        valid: false,
        error: err?.message || "Invalid OpenAI API key",
      },
      { status: 200 } // intentional: validation failure ≠ server error
    );
  }
}
