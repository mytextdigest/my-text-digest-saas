// Chat system prompts instruct the model to reply in plain text (no markdown),
// but gpt-4o-mini doesn't always comply — deterministic backstop since nothing
// in the chat UI parses markdown (ChatInterface.jsx / document/page.jsx render
// message.content as raw whitespace-pre-wrap text).
export function stripMarkdownArtifacts(text) {
  if (!text) return text;
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[*-]\s+/gm, "");
}
