// worker/openai.js
// Re-exports the shared implementation from src/lib/openaiForDocument.js —
// moved there so a Next.js API route (generate-slide-image) can import it
// too without reaching several directories up into worker/. Kept as a
// re-export here so every existing `from "./openai.js"` import in this
// directory (processFigures.js, processSlideOutline.js, ...) keeps working
// unchanged.
export { getOpenAIForDocument } from "../src/lib/openaiForDocument.js";
