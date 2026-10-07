// src/lib/models.js
// Central place to name which OpenAI model backs each kind of call, so a
// future tier change is a one-line edit instead of a grep-and-replace.
// Mirrors the desktop's electron/config/models.js.

// Image generation (slide images, chat image turns). gpt-image-1 shuts
// down 2026-10-23. gpt-image-2 rejects the input_fidelity parameter (it
// always uses high input fidelity).
export const MODEL_IMAGE = "gpt-image-2";

// Vision calls in chat image turns (routing, reading chart data, checking
// the generated image). Read 4 test charts exactly like gpt-4o at ~1/5 the
// cost; gpt-4o-mini is no cheaper for images (it bills far more tokens).
export const MODEL_CHAT_VISION = "gpt-4.1-mini";
