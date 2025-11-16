import pLimit from "p-limit";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const limit = pLimit(5);   // concurrency for summarizing chunks

export async function summarizeChunks(chunks, filename) {
  console.log(`🟡 Starting summarization for: ${filename} (${chunks.length} chunks)`);

  const summarizeChunk = async (chunkText, idx) => {
    const start = Date.now();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant who summarizes text clearly and concisely." },
        { role: "user", content: `Summarize this chunk:\n\n${chunkText}` },
      ],
      temperature: 0.3,
      max_tokens: 300,
    });

    const summary = completion.choices[0].message.content.trim();

    console.log(`   ⏱️ Chunk ${idx + 1}/${chunks.length} summarized in ${(Date.now() - start) / 1000}s`);
    return summary;
  };

  const results = await Promise.all(
    chunks.map((chunk, idx) => limit(() => summarizeChunk(chunk, idx)))
  );

  return results;
}

export async function createStructuredSummary(chunkSummaries, filename) {
  const joined = chunkSummaries.join("\n\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },   // 👈 FORCE VALID JSON
    messages: [
      {
        role: "system",
        content: `
You must output ONLY valid JSON. 
No commentary, no explanations, no markdown, no quotes around the entire object.
Your output must parse using JSON.parse().
`
      },
      {
        role: "user",
        content: `
Create a structured summary from the following chunk summaries:

Requirements:
{
  "overview": "3–5 sentence plain-text overview",
  "keyPoints": ["5–8 plain-text bullet points"]
}

Chunk summaries:
${joined}
`
      },
    ],
    temperature: 0.2,
    max_tokens: 500,
  });

  const raw = completion.choices[0].message.content.trim();

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ JSON parsing failed. Using fallback.");
    return {
      overview: raw,
      keyPoints: [],
    };
  }
}
