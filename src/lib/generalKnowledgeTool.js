// consult_general_knowledge — an OpenAI tool the chat models can call when a
// question needs information genuinely outside the document/project context
// (e.g. an external comparison figure). The tool call is never auto-run: the
// caller stashes it here and only resolves it once the user has approved or
// declined via the confirmation prompt.

export const GENERAL_KNOWLEDGE_TOOL = {
  type: "function",
  function: {
    name: "consult_general_knowledge",
    description:
      "Call this ONLY when answering the user's question requires information that is genuinely " +
      "NOT contained in the provided document context — for example comparing document figures " +
      "against external or current-year data, general world knowledge, or facts about topics the " +
      "documents don't cover. Do not call this for anything answerable from the document alone. " +
      "Provide a precise, self-contained query describing exactly what outside information is needed.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A precise, self-contained question describing exactly what outside information is needed.",
        },
      },
      required: ["query"],
    },
  },
};

const GENERAL_KNOWLEDGE_SYSTEM_PROMPT = `Answer directly and concisely from your general training knowledge. Always give your
best concrete answer — the most recent figure or fact you actually have from training
— even if it may be somewhat dated. Do NOT respond with only a refusal or a suggestion
to 'check the latest reports/sources'; if you have any relevant figure, state it, then
add a brief one-line caveat that it may not reflect the most recent period if that's a
real concern. Only say you have no relevant knowledge at all if you truly have none.`;

export async function consultGeneralKnowledge({ openai, query, signal }) {
  const completion = await openai.chat.completions.create(
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: GENERAL_KNOWLEDGE_SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
      temperature: 0.3,
      max_tokens: 400,
    },
    { signal }
  );

  return (completion?.choices?.[0]?.message?.content || "").trim();
}

// requestId -> stashed record (see Backend section of the feature spec for the
// shape of `data`). Get-and-delete semantics via takePendingToolCall so a given
// pending tool call can only ever be resolved once.
export const pendingToolCalls = new Map();

export function stashPendingToolCall(requestId, data) {
  pendingToolCalls.set(requestId, data);
}

export function takePendingToolCall(requestId) {
  const pending = pendingToolCalls.get(requestId);
  if (pending) pendingToolCalls.delete(requestId);
  return pending;
}

// Resolves a stashed tool call — either by actually consulting general
// knowledge (approved) or by politely declining (not approved) — then makes
// one final completion call WITHOUT `tools` to produce the answer. Bounded to
// exactly one extra hop either way, so there's no loop risk.
export async function resolveToolCall({
  openai,
  baseMessages,
  assistantMessage,
  toolCall,
  approved,
  signal,
  completionOptions,
}) {
  let query = "";
  try {
    query = JSON.parse(toolCall.function.arguments || "{}").query || "";
  } catch {
    query = "";
  }

  let toolResultContent;
  if (approved) {
    toolResultContent = await consultGeneralKnowledge({ openai, query, signal });
  } else {
    toolResultContent =
      "The user declined to allow general knowledge to be used for this query. " +
      "Answer using only the document/project context provided earlier in this conversation, " +
      "and if it truly cannot be answered from that context alone, say so plainly.";
  }

  const messages = [
    ...baseMessages,
    assistantMessage,
    {
      role: "tool",
      tool_call_id: toolCall.id,
      content: toolResultContent,
    },
  ];

  const completion = await openai.chat.completions.create(
    {
      model: completionOptions?.model || "gpt-4o-mini",
      messages,
      temperature: completionOptions?.temperature ?? 0.3,
      max_tokens: completionOptions?.max_tokens ?? 800,
    },
    { signal }
  );

  return {
    completion,
    externalKnowledgeQuery: approved ? query : null,
  };
}
