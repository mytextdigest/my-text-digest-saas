# Ask Question Tool (General-Knowledge Escape Hatch) — Implementation Spec (Cloud/SaaS)

## Purpose

This document is the liaison spec for porting the "Ask Question tool" feature from the
desktop Electron app (`mytextdigest`) to this cloud/SaaS codebase. The desktop version
is already built, tested, and iterated on through two live debugging rounds — this spec
captures the final, verified design **and** the two real bugs hit and fixed along the
way, so they aren't re-discovered here. Follow this as the source of truth; it is more
current and more detailed than re-deriving the feature from scratch would be.

As with the charts and citations ports before it, the two codebases are close ports of
each other — confirmed again while researching this spec: `src/app/api/documents/[id]/ask/route.js`
here is close to line-for-line the same logic as the Electron app's `ask-document` IPC
handler, and `src/app/api/projects/ask/route.js` mirrors `ask-project` (including the
same unselected-document blocking rules and the same BM25-fallback/cosine-similarity
branch split). Most of the design below transfers directly. The differences that do
**not** transfer — no Electron IPC push events, per-user OpenAI keys instead of one
global key, and a new cross-user security check that has no desktop equivalent — are
called out explicitly in each section.

## What ships

- A new OpenAI tool, `consult_general_knowledge`, offered to the model on every chat
  turn in **both** chat surfaces: document chat (`src/app/(app)/document/page.jsx`,
  backend `src/app/api/documents/[id]/ask/route.js`) and project chat
  (`src/components/chat/ChatInterface.jsx`, backend `src/app/api/projects/ask/route.js`,
  **both** of its GPT-reaching branches — see "Wiring" below).
- The model decides autonomously (native OpenAI tool-calling, `tool_choice: "auto"`)
  whether a question needs information outside the document(s) — e.g. "how does this
  margin compare to Tesla's?" — versus being fully answerable from the retrieved
  context.
- **The tool is never run silently.** When the model wants to use it, the user sees a
  permission prompt — *"This question needs general knowledge beyond this document —
  '\<query>'. Should I go ahead?"* — with **stacked, near-full-width Yes/No buttons**
  (this exact layout was a locked-in UI tweak requested and applied on the desktop
  version; see screenshot-equivalent description in Frontend section). Only after the
  user clicks Yes does the model actually consult its general knowledge; clicking No
  tells the model to answer from the document alone.
- The answer comes from the model's own general/training knowledge only — **there is
  no live web search integration** — so the UI also shows a small collapsible
  disclosure badge on the settled message noting outside knowledge was used, with a
  one-line staleness caveat.
- No streaming/SSE infrastructure is introduced. The confirmation gate naturally splits
  the flow into two ordinary REST round-trips (ask → maybe-confirm → respond), and the
  desktop's Electron-IPC "consulting general knowledge…" progress push has a
  zero-infrastructure equivalent here: the frontend flips to that visual state locally,
  synchronously, right before firing the second `fetch()` call. See "Locked-in
  decisions" below for why this is not a regression relative to the desktop UX.

## Locked-in decisions (do not relitigate)

**Knowledge source is the model's own general/training knowledge only — no web search
API.** This was an explicit decision on the desktop build (the user was offered a
real-web-search alternative and chose general-knowledge-only, accepting that answers
about very recent events may be stale — hence the disclosure badge's caveat). Do not
add a search API (Tavily/Serper/Bing) as part of this port; that would be a materially
larger, separate feature.

**Decision mechanism is native OpenAI tool-calling (`tools` + `tool_choice: "auto"`),
not a custom JSON-flag prompt.** Chosen on the desktop build over a
`response_format: json_object` "should I use outside knowledge?" flag (the pattern this
repo already uses for `chartSpec.js`) because it's the idiomatic mechanism for a genuine
"the model may invoke a capability" decision, and it composes cleanly with the
confirm/decline round-trip via the standard `tool` message role.

**The tool call requires explicit user confirmation before running — it is NOT
auto-resolved.** This was **not** the desktop app's original design. The first
desktop implementation ran the tool automatically the instant the model called it
(fetch the general knowledge, splice it in, answer — no user involved). The user
explicitly asked, after seeing that version, for a permission gate instead — the exact
request was: *"it did not ask for permission... like 'this question requires general
knowledge beyond this doc, should I go ahead?' Then yes or no option. And then the
response."* Build the confirmation gate from the start here; do not build the
auto-resolving version first and add confirmation as a follow-up, since that requires
restructuring the backend from a single-completion flow into a stash/resume flow (see
Backend section) — going straight to the stash/resume design avoids that rework.

**Yes/No buttons are stacked vertically, near-full-width of the prompt bubble — not
side-by-side small buttons.** This was a specific UI correction requested after the
first confirmation-prompt version shipped (small inline `Yes` / `No` buttons side by
side). Build the stacked, full-width version directly (exact classes given in Frontend
section) rather than the side-by-side version.

**No server-push/streaming mechanism is needed for the "consulting general
knowledge…" progress indicator.** The desktop version uses an Electron IPC push
(`event.sender.send("chat-progress", ...)`) because the two-phase flow lives inside a
single conceptual request from the renderer's point of view and Electron has a
main→renderer push channel available for free. This cloud codebase has no server-push
mechanism (no WebSocket/SSE wired up anywhere, and introducing one would be a much
larger change than this feature warrants — the "Enterprise Chat" milestone in
`IMPLEMENTATION_TRACKER.md` lists "streaming RAG" as a still-`TODO` future item, not
something to pull forward here). **This isn't actually a gap**: the confirmation gate
already splits processing into two separate HTTP requests (the initial `ask`, which may
return `needsConfirmation` near-instantly with no OpenAI call in flight yet, and a
second `respond` call once the user clicks Yes/No, which is where the actual
general-knowledge fetch happens). The frontend can set its local "consulting general
knowledge…" UI state synchronously, immediately before firing the second `fetch()`, and
clear it when that promise resolves — this reproduces the exact visual behavior of the
desktop's IPC push with zero new plumbing.

## Prompt design — two real bugs, both already fixed, do not repeat them

Both were hit live during desktop testing, after the tool was correctly wired end to
end. Neither is a routing/plumbing bug — both are prompt-conservatism bugs, and both
transfer directly since the underlying model behavior doesn't depend on the backend
runtime.

### Bug 1 — the tool-call exception got buried after a stronger, more specific instruction and never fired

**What happened:** with the tool correctly wired (`tools: [GENERAL_KNOWLEDGE_TOOL],
tool_choice: "auto"`) and a naive "Exception: call the tool if the question needs
outside info" bullet appended to the end of the existing rules list, live test
questions like *"How does this margin compare to Tesla's?"* were answered directly
("The document does not provide Tesla's margin... however Solstice's margin is
15.3%.") — **the tool was never called.** Root cause: the document system prompt (and
this repo's is line-for-line similar) already contains an earlier, more specific
instruction for exactly this situation: *"If the document does not fully answer the
question, provide the closest accurate information the document contains (do not say
'I don't know')."* The model followed that concrete, earlier rule every time; a soft
"exception" bullet tacked on at the end of a list never got a chance to compete with
it. The project-chat prompt has the same failure mode via its `FACTUAL QUESTIONS` mode
("If not found, reply: 'I cannot answer that...'").

**Fix — make the tool decision a mandatory STEP 0, evaluated before any other rule,**
not an exception appended after them. Verified live on the desktop build across all
three test questions (industry-average comparison, competitor-valuation comparison,
named-competitor margin comparison) after this restructuring — all three correctly
triggered the confirmation prompt.

Use this exact structure for `src/app/api/documents/[id]/ask/route.js`'s `systemMsg`
(current content at lines 265-285 — see Backend section for exact insertion point):

```
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
```

(then append `chartNote` exactly as the current code already does — this prompt is a
drop-in replacement for the existing `systemMsg.content` template, chart wiring
untouched.)

The **second block** — "If a consult_general_knowledge tool result already appears..."
— is not decorative; it fixes Bug 2 below and must be included, not just the STEP 0
block.

For `src/app/api/projects/ask/route.js`, the **main branch** system prompt (current
content at lines 460-488) needs the same STEP 0 treatment adapted to its own
structure (it doesn't use a "THREE MODES" heading like the desktop version's
project-chat prompt does — this repo's version is plain prose, so adapt the wording
rather than copy-pasting the desktop's `THREE MODES`/`BLOCKING RULES` framing
verbatim):

```
You are an expert assistant that answers questions *based on selected project documents*.

STEP 0 — do this check FIRST, before applying anything below:
Does fully answering this question require information that is NOT in the selected
documents — e.g. another company's or product's data, current/live/today's data,
industry or market benchmarks, or general world knowledge the documents don't cover?
- If YES: you MUST call the consult_general_knowledge tool with a precise, self-contained
  query for exactly that missing piece. Do this instead of answering. Do NOT say the
  documents don't contain the information, do NOT give a partial answer, do NOT guess —
  call the tool. Never use this tool to bypass the unselected-document rule below.
- If NO (the question is fully within the documents' own subject matter): continue below
  and answer from the documents only.

If a consult_general_knowledge tool result already appears earlier in this conversation,
that content IS authorized outside information for this answer — use it directly, noting
briefly that it comes from general knowledge and may not be fully current. Do NOT refuse
or redirect the user to look it up themselves once the tool has already supplied an answer.

You may:
- Summarize document content
- Explain document content
- Compare document content
- Generate new text (letters, emails, reports, etc.)
  as long as the factual information used comes from the selected documents.

Do NOT (once STEP 0 has determined the tool is NOT needed):
- Use information from unselected documents.
- Invent factual information that is not supported by the selected documents.

If a user asks about an unselected document:
"The document is unselected or does not exist, so I cannot answer that."

If a factual answer cannot be found in the selected documents — and the missing piece is
within the documents' own scope, not external comparison data (see STEP 0):
"I cannot answer that based on the selected documents."

Response format:
- Plain text only (no markdown, no lists, no special formatting).
- When you refer to a specific document by name, quote its filename exactly as it
  appears after "Document:" in the context above (including the extension), so it can
  be linked back to the source.
```

Apply the same STEP 0 treatment to the **BM25-fallback branch's** system prompt
(current content at lines 297-305, `"You are answering based on extracted text
only..."`) — this repo already extends that branch with chart generation (confirmed
at lines 281-296), so extending it with the tool as well keeps both branches at
feature parity, same as charts already established. This is a deliberate inclusion
beyond what the citations feature did (citations spec explicitly skipped the BM25
branch as "a transient state ... not worth the extra code path") — the calculus is
different here because the tool wiring cost is identical in both branches (just the
`tools`/`tool_choice` params and the stash-on-tool-call branch), unlike citations which
needed its own dedupe/matching logic.

### Bug 2 — the general-knowledge sub-call itself refused instead of giving a best-effort answer

**What happened:** after Bug 1 was fixed and the confirmation prompt correctly
appeared, approving it for *"How does this margin compare to Tesla's?"* produced: *"I
cannot provide Tesla's most recent reported operating margin as it requires current
data not included in the document. Please refer to Tesla's latest financial reports."*
— a flat refusal, even though the user had just approved using general knowledge.

**Root cause, two contributing prompts, both must be fixed together:**

1. The sub-call that's supposed to actually answer the outside-knowledge query
   (`consultGeneralKnowledge`) told the model: *"if you may not have accurate
   up-to-date information, say so plainly instead of guessing precise figures."*
   `gpt-4o-mini` read that as license to flatly refuse rather than give its best-known
   figure with a caveat.
2. Independently, the **final synthesis pass** reuses the original system prompt
   (STEP 0's document above), which still says "NEVER use information not present in
   the document context" with no carve-out for the tool's own result — so even a good
   sub-call answer could get second-guessed back into a refusal. This is exactly why
   the "If a consult_general_knowledge tool result already appears..." paragraph in
   both STEP-0 prompts above is required, not optional.

**Fix for the sub-call** — use this exact system prompt for the general-knowledge
lookup call (see `consultGeneralKnowledge` in the Backend section):

```
Answer directly and concisely from your general training knowledge. Always give your
best concrete answer — the most recent figure or fact you actually have from training
— even if it may be somewhat dated. Do NOT respond with only a refusal or a suggestion
to 'check the latest reports/sources'; if you have any relevant figure, state it, then
add a brief one-line caveat that it may not reflect the most recent period if that's a
real concern. Only say you have no relevant knowledge at all if you truly have none.
```

Verified live on the desktop build: after both fixes, the Tesla margin question
returned an actual approximate figure with a "may not reflect the latest quarter"-style
caveat, not a refusal.

## Tool contract (shared between both chat surfaces)

```js
const GENERAL_KNOWLEDGE_TOOL = {
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
```

The tool is **never** executed the instant the model calls it. The first completion's
`tool_calls[0]` is stashed server-side and the API responds with
`{ success: true, needsConfirmation: true, requestId, query }` instead of an answer.
A second request (`respond-general-knowledge`, see below) supplies `approved: true|false`
and only then does the real second completion happen — bounded to exactly one extra
round-trip either way (approve or decline), no loop risk, since the second completion
call omits `tools` entirely.

## Backend implementation

### New shared module — `src/lib/generalKnowledgeTool.js`

This is **~100% portable verbatim** from the Electron reference
(`electron/chat/generalKnowledgeTool.js`) — it's pure OpenAI SDK calls and in-memory
state, zero Electron- or SQLite-specific code. Copy it over and only rename nothing;
the only cloud-specific addition is documented in "Security note" below (an
`ownerKey` field on the stashed record, not present in the desktop version because
desktop has no cross-user boundary to defend).

Exports, matching the desktop module 1:1:

- `GENERAL_KNOWLEDGE_TOOL` — the tool spec above.
- `consultGeneralKnowledge({ openai, query, signal })` — one `gpt-4o-mini` completion
  using the **fixed** (non-refusal) prompt from Bug 2 above. `temperature: 0.3,
  max_tokens: 400`, matching desktop.
- `pendingToolCalls` — a module-level `Map`, same idiom as this repo's existing
  `activeRequests` (`src/lib/requestCancellation.js`) — keyed by `requestId`.
- `stashPendingToolCall(requestId, data)` / `takePendingToolCall(requestId)` — get-and-delete
  semantics, identical to desktop.
- `resolveToolCall({ openai, baseMessages, assistantMessage, toolCall, approved, signal, completionOptions })`
  — runs (or politely declines, injecting the "user declined" tool-result text) the
  tool call, then re-invokes the model once more **without** `tools` for the final
  answer. Identical to desktop, including the bounded-to-one-hop design.

**Cloud-specific addition to the stashed record shape** (not present on desktop): every
call to `stashPendingToolCall` must include `ownerUserEmail: session.user.email` (or
`ownerUserId`, pick one consistently) captured from the *first* request's session. This
is consumed by the new `respond-general-knowledge` route's ownership check — see
Security note below. This is a plain data field on the stashed object, not a change to
the module's exported functions' signatures.

### Prisma schema migration

```prisma
model Message {
  // ...existing fields
  externalKnowledgeQuery String? @map("external_knowledge_query")
}

model ProjectMessage {
  // ...existing fields
  externalKnowledgeQuery String? @map("external_knowledge_query")
}
```

Run `npx prisma migrate dev --name add_external_knowledge_query`. This is a plain
nullable `String` column (not `Json?` — desktop stores this as a single query string,
not a structured payload), following the same `@map()` convention already used for
`chartData`/`citations` on both models.

### Wiring into `src/app/api/documents/[id]/ask/route.js`

1. Import `GENERAL_KNOWLEDGE_TOOL`, `stashPendingToolCall`, `takePendingToolCall`,
   `resolveToolCall` from `@/lib/generalKnowledgeTool` (alongside the existing
   `detectChartIntent`/`generateChartSpec` import at line 11).
2. Replace the `systemMsg.content` template (lines 267-284) with the STEP-0 version
   from the Prompt design section above (keep the existing `.trim() + chartNote`
   suffix — untouched).
3. In the GPT call block (lines 309-321), add `tools: [GENERAL_KNOWLEDGE_TOOL],
   tool_choice: "auto"` to the `openai.chat.completions.create` call.
4. After the call succeeds, check `completion?.choices?.[0]?.message?.tool_calls?.[0]`.
   If it's `consult_general_knowledge`:
   - Parse `query` from `toolCall.function.arguments`.
   - `stashPendingToolCall(requestId, { kind: "document", conversationId, userMsgId:
     userMsg.id, baseMessages: [systemMsg, ...memoryMsgs, userMsgGPT], assistantMessage:
     completion.choices[0].message, toolCall, query, chartSpec, ownerUserEmail:
     session.user.email, apiKeyUserId: userId /* = doc.userId, needed to re-fetch the
     correct per-user key in respond-general-knowledge */, completionOptions: { model:
     "gpt-4o-mini", temperature: 0.2, max_tokens: 700 } })`.
   - `return NextResponse.json({ success: true, needsConfirmation: true, requestId,
     conversationId, query })` — **before** the existing `finally { activeRequests.delete(requestId)
     }` at line 358-360 (that finally still runs on this early return since `finally`
     always executes — that's fine here, see Cancellation note below).
   - Do not fall through to the existing persistence/return logic (lines 362-391) in
     this case.
5. If there's no tool call, the existing flow (lines 362-391) is completely unchanged.

### Wiring into `src/app/api/projects/ask/route.js`

Same import as above. Two call sites need the tool, matching the existing chart
feature's reach into both branches:

**BM25-fallback branch** (~lines 297-336): replace the `systemMsg.content` (lines
299-304) with the STEP-0-adapted BM25 version, add `tools`/`tool_choice` to the
`openai.chat.completions.create` call at line 326, and branch on `tool_calls[0]` the
same way as the document route — `stashPendingToolCall(requestId, { kind: "project",
conversationId: conv.id, userMsgId: userMsg.id, baseMessages: messages, assistantMessage,
toolCall, query, chartSpec, ownerUserEmail: session.user.email, apiKeyUserId:
session.user.id, allChunksForCitations: allChunks, completionOptions: { model:
"gpt-4o-mini", temperature: 0.3, max_tokens: 800 } })`, returning
`{ success: true, needsConfirmation: true, requestId, query }` in place of the existing
return at line 356.

**Main cosine-similarity branch** (~lines 460-547): same pattern — replace `systemMsg.content`
(lines 462-487) with the STEP-0-adapted main version, add `tools`/`tool_choice` to the
call at line 496, branch on `tool_calls[0]`, stash the same shape (`baseMessages:
[systemMsg, ...memoryMsgs, userMsgForModel]`, `allChunksForCitations: allChunks`,
`completionOptions: { model: "gpt-4o-mini", temperature: isGenerative ?? 0.3 — actually
this route doesn't compute `isGenerative` at all, unlike the desktop version; just use
the existing fixed `0.3` already used at line 500, max_tokens: 800 }`), returning
`needsConfirmation` in place of the existing return at line 547.

The three early-return blocking paths (unselected-document mention, "no documents
found", ~lines 172-235) are unaffected — they return canned strings, never reach a GPT
call, so there's nothing to gate.

### New route — `src/app/api/chat/respond-general-knowledge/route.js`

One shared endpoint for both chat surfaces, mirroring the desktop's single
`respond-general-knowledge` IPC handler (both `kind: "document"` and `kind: "project"`
pending records carry everything the resolution logic needs, so one route can serve
both, same as desktop's single handler does).

```js
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
  // anything else — see "Security note" below for why this check is mandatory here
  // and has no desktop equivalent.
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
```

### Security note (NEW surface — needs enforcement, unlike prior ports)

Every prior liaison spec's "Security note" section could say "no new surface
introduced" because those features only ever read data already scoped to the
requesting user. **This feature is different**: `respond-general-knowledge` is
reached by `requestId` alone, and `requestId` is a client-generated string
(`req-${Date.now()}-${Math.random()...}`) — not a secret, and not itself scoped to a
user by construction. Without the `pending.ownerUserEmail !== session.user.email`
check shown above, any authenticated user who learned or guessed another user's
in-flight `requestId` could approve/decline *that other user's* pending tool call —
which would run a real OpenAI completion **billed to the other user's own API key**
(`getUserOpenAIKey`) and return the other user's document/project answer content to
the attacker. This has no desktop equivalent because the desktop app has exactly one
local user and no auth boundary at all. **Do not ship this route without the ownership
check** — it is the one place in this entire feature where "close port of the desktop
version" is not sufficient on its own.

### Cancellation

Reuse the existing `activeRequests` (`src/lib/requestCancellation.js`) +
`AbortController` + `/api/cancel/route.js` pattern — no new cancellation plumbing for
the first `ask` call (same as charts/citations before it). Additionally, update
`/api/cancel/route.js` to also discard a pending confirmation if the user hits
stop/cancel while the Yes/No prompt is still showing (nothing is actually in flight
server-side during that idle wait, so this is just cleanup, not an abort):

```js
import { takePendingToolCall } from "@/lib/generalKnowledgeTool";
// ...inside POST handler, alongside the existing controller lookup:
const discardedPending = !!takePendingToolCall(requestId);
const cancelled = !!controller || discardedPending;
if (controller) { controller.abort(); activeRequests.delete(requestId); }
return NextResponse.json({ success: cancelled, cancelled });
```

(This module-level `Map` cancellation pattern already carries an accepted limitation in
this codebase — it only works correctly if `ask`/`cancel`/`respond-general-knowledge`
land on the same running Node process; this is a pre-existing characteristic of
`activeRequests`, not something this feature changes or needs to solve.)

### Message-history routes

- `src/app/api/projects/messages/[projectId]/route.js` — add one field to the `mapped`
  array (lines 34-43), matching how `chartData`/`citations` were already added there:
  `externalKnowledgeQuery: m.externalKnowledgeQuery || null`.
- `src/app/api/documents/messages/[conversationId]/route.js` — **no change needed.**
  This route returns raw Prisma rows with no `select`/mapping (lines 24-29) — once the
  column exists on `Message`, it flows through automatically, the same way `chartData`
  already does today without this route having been touched for the charts feature
  either (confirmed while reading the current file).

## Frontend implementation

### New shared component — `src/components/chat/ExternalKnowledgeBadge.jsx`

This ports **verbatim** from the Electron reference
(`src/components/chat/ExternalKnowledgeBadge.jsx` in the desktop repo) — it's plain
React + Tailwind + `lucide-react` + `framer-motion`, all of which already exist
identically in this codebase, and it imports only `@/components/ui/Button` (confirmed
identical `variant`/`size` API in both repos). Copy the file with no changes needed.
Exports three pieces:

- `GeneralKnowledgePermissionPrompt({ query, onApprove, onDecline })` — the confirmation
  bubble. **Yes/No buttons are stacked (`flex-col`) and full-width (`w-full`)**, not
  side-by-side — this is the exact locked-in layout from "Locked-in decisions" above:

  ```jsx
  <div className="flex flex-col gap-2 mt-3">
    <Button size="sm" onClick={onApprove} className="w-full bg-blue-500 hover:bg-blue-600 text-white border-0">
      Yes, go ahead
    </Button>
    <Button size="sm" variant="outline" onClick={onDecline} className="w-full">
      No, use the document only
    </Button>
  </div>
  ```
- `GeneralKnowledgeProgressChip()` — the transient "Consulting general knowledge beyond
  the document…" chip (a `Globe` icon + text in a pill, matching the existing
  typing-indicator bubble's visual weight).
- `ExternalKnowledgeBadge({ query })` — the settled-message collapsible disclosure
  (click to expand the actual query + a "may not reflect the most recent information"
  caveat line).

### Shared confirmation-gate logic — recommended: introduce `useChatEngine`

**This is a deliberate deviation from how charts and citations were ported**, and is
worth flagging explicitly per this repo's own convention of calling out where a port
departs from precedent. Both prior features were wired by duplicating a small amount of
logic directly into `ChatInterface.jsx` and `document/page.jsx` separately (documented
in both prior specs as "Wiring into `ChatInterface.jsx` and `document/page.jsx`," two
separate sub-sections). That worked because the added logic was simple and stateless
per-message (a `chart` field, a `citations` field, a render branch).

The confirmation gate is not that simple: it needs a `pendingConfirmation` state, a
`progress` state, and — critically — a subtle rule that a naive implementation is
likely to get wrong independently in each file: while `pendingConfirmation` is active,
the request is **not finished** (the typing indicator / disabled input must stay in
that state across the whole ask → confirm → respond sequence), but the *existing*
`finally { setIsTyping(false); ... }` blocks in both `handleSendMessage`/`handleAsk`
run unconditionally on every code path, including the `needsConfirmation` early return
— naively they would clear `isTyping` right as the confirmation prompt appears,
re-enabling the input mid-flow. (This exact bug was hit and fixed on the desktop
build — the fix is a local `let awaitingConfirmation = false` flag set inside the `try`
block and checked in `finally` before resetting state.) Duplicating this correctly,
independently, across a 550-line and a 1424-line file is a real risk of the two copies
silently diverging over time.

**Recommendation:** extract a shared hook, `src/components/chat/useChatEngine.js`,
ported from the desktop version (`src/components/chat/useChatEngine.js` there) with one
change: **remove the `chat-progress` IPC-listener `useEffect` entirely** (there is no
`window.api` in this codebase, and per "Locked-in decisions" above, no server push is
needed) — the hook instead exposes `respondToConfirmation(approved)`, which sets local
`progress` state synchronously before `await fetch(...)`, achieving the same visual
result without any listener. Everything else — `sendMessage`, `cancel`, the
`awaitingConfirmation` guard, `pendingConfirmation` state — ports directly, with the
`ask` adapter's body swapped from `window.api.askDocument(...)`/`window.api.askProject(...)`
to the existing `fetch("/api/documents/${id}/ask", { ... })`/`fetch("/api/projects/ask", { ... })`
calls already present in each file, and `respondToConfirmation` calling
`fetch("/api/chat/respond-general-knowledge", { method: "POST", credentials: "include",
body: JSON.stringify({ requestId, approved }) })`.

Both `ChatInterface.jsx` (`type` field naming) and `document/page.jsx` (`role` field
naming) keep their own existing message-field-name quirk — the hook doesn't need to
unify that, only the send/cancel/confirm *mechanics*. If duplicating instead of
extracting a hook is preferred to stay maximally consistent with how citations/charts
were ported, the same design still applies — every state name and the
`awaitingConfirmation` guard above must then be copied correctly into **both** files
independently; there is no reduction in required logic, only in shared vs. duplicated
code.

### Wiring into `ChatInterface.jsx`

- Import `useChatEngine` (or, if duplicating, add the equivalent local state) and
  `GeneralKnowledgeProgressChip`, `GeneralKnowledgePermissionPrompt`,
  `ExternalKnowledgeBadge` from `./ExternalKnowledgeBadge`.
- `ask` adapter: `(question, requestId) => fetch("/api/projects/ask", { method: "POST",
  credentials: "include", headers: {...}, signal: controller.signal, body:
  JSON.stringify({ projectId, question, requestId }) }).then(r => r.json())` — reuses
  the exact fetch call already at lines 130-136, just relocated into the adapter.
- `mapAskResult`: add `externalKnowledgeQuery: res.externalKnowledgeQuery || null` to
  the object already built at lines 149-156.
- `mapHistoryMessage`: add `externalKnowledgeQuery: m.externalKnowledgeQuery || null`
  to the mapping already at lines 82-90.
- Render (message loop, ~lines 391-424): after the existing
  `{message.type === 'assistant' && message.chart && <ChartMessage .../>}` block (lines
  420-422), add:
  ```jsx
  {message.type === 'assistant' && (
    <ExternalKnowledgeBadge query={message.externalKnowledgeQuery} />
  )}
  ```
- Typing-indicator block (~lines 431-461): split into a `pendingConfirmation` branch
  (renders `GeneralKnowledgePermissionPrompt`) and the existing `isTyping` branch,
  guarded so only one shows at a time — same two-block pattern as the desktop
  `ChatInterface.jsx` reference (permission prompt first, then
  `{isTyping && !pendingConfirmation && (...)}` with the existing dots, swapping in
  `GeneralKnowledgeProgressChip` when `progress?.stage === 'consulting_general_knowledge'`,
  exactly mirroring the existing chart/citation wiring's "add a conditional render
  branch, don't touch the rest" style.

### Wiring into `document/page.jsx`

Same shape, applied to the inline `chat`/`handleAsk`/`handleCancelRequest` state
(lines 32-47, 525-631) and the render block (lines 1035-1131):

- `ask` adapter wraps the existing `fetch(`/api/documents/${id}/ask`, ...)` call at
  lines 546-556.
- `mapAskResult` / message-history mapping (lines 360-366) both gain
  `externalKnowledgeQuery`.
- Insert the `ExternalKnowledgeBadge` render call next to the existing
  `{message.role === 'assistant' && message.chart && <ChartMessage .../>}` block
  (lines 1098-1100).
- Split the `{isTyping && (...)}` block (lines 1108-1128) into the permission-prompt /
  progress-chip / plain-dots three-way branch, same as `ChatInterface.jsx` above.

### New dependency

None — `lucide-react` (for the `Globe`/`ChevronDown`/`ChevronUp` icons used in
`ExternalKnowledgeBadge.jsx`) and `framer-motion` are both already present in
`package.json`.

## Verification plan

This repo has no automated test suite covering chat (confirmed, same as the charts
spec noted). Verify manually, end-to-end, against a real dev server (`npm run dev`),
using a real per-user OpenAI key (`getUserOpenAIKey`) set for the test account:

- Ask a question fully answerable from the document (e.g. "summarize this") in both
  chat surfaces — confirm no tool call, no permission prompt, answer unchanged from
  pre-feature behavior, no disclosure badge.
- Ask a genuine external-comparison question (e.g. "how does this operating margin
  compare to Tesla's most recent reported operating margin?") in both surfaces —
  confirm the permission prompt appears with the exact query text, buttons are stacked
  and near-full-width, and:
  - **Yes** → progress chip shows, then a real answer arrives with a concrete figure
    (not a refusal) and the disclosure badge is present and expandable.
  - **No** → the model answers from the document alone (or states it can't, if truly
    unanswerable from the document), no disclosure badge.
- Reload the page / revisit the project after an approved answer — confirm
  `externalKnowledgeQuery` and the disclosure badge survive the round trip through
  Postgres (both `GET /api/documents/messages/[conversationId]` and
  `GET /api/projects/messages/[projectId]`).
- Click Stop/Cancel while the permission prompt is showing — confirm it clears cleanly
  with no orphaned request, and that `takePendingToolCall` actually discarded the
  server-side stash (a second, delayed manual POST to `respond-general-knowledge` with
  the same `requestId` should now 404).
- **Security check (no desktop equivalent — do not skip):** as User B, attempt to POST
  to `/api/chat/respond-general-knowledge` with a `requestId` that belongs to a pending
  request stashed under User A's session — confirm a 404, not User A's document
  content or a completion billed to User A's key.
- Test the BM25-fallback branch specifically (a project with documents still
  mid-embedding) with an external-comparison question — confirm the tool triggers
  there too, not just in the main cosine-similarity branch.
- Run a batch of ordinary questions across both surfaces after all changes — confirm
  latency and answers for non-triggering questions are unaffected (the `tools` param
  on the first call is cheap to include and should not change behavior when unused).
- If a user's own OpenAI key hits a quota/billing limit, confirm the
  `consult_general_knowledge` sub-call's failure surfaces as a real error response
  (via the existing catch/error-message path in `respond-general-knowledge`) rather
  than a silent hang — same class of issue the charts spec's verification plan called
  out for per-user keys.
