// src/lib/tables/config.js
// Every threshold and cap used by table extraction, in one place so tuning
// against the golden fixtures is a one-file change.
const config = {
  // OpenAI models (desktop keeps these in electron/config/models.js, which
  // has no counterpart here). Reading tables from images: transcription
  // accuracy matters more than price.
  MODEL_VISION: "gpt-4o",
  MODEL_QA: "gpt-4o-mini",

  // Detection confidence (0..1). Below KEEP the candidate is dropped (counted
  // in table_extraction_log.skipped_low_conf); between KEEP and HIGH it is
  // kept but marked low-confidence and eligible for LLM repair.
  CONFIDENCE_KEEP: 0.55,
  CONFIDENCE_HIGH: 0.75,

  // Caps
  MAX_TABLES_PER_DOCUMENT: 200,
  MAX_CELLS_PER_TABLE: 5000,
  MAX_REPAIRS_PER_DOCUMENT: 10,

  // Minimum shape of a real table
  MIN_COLUMNS: 2,
  MIN_DATA_ROWS: 2,

  // A column is numeric when at least this share of its non-empty cells parse
  // (the same 80 % rule computeSpreadsheetStats has always used).
  NUMERIC_COLUMN_RATIO: 0.8,

  // Totals are recognised when values equal the column sum within this ratio.
  TOTAL_TOLERANCE: 0.005,

  // Chat context: max characters of one table's context block, and max
  // tables expanded into one answer's context.
  CONTEXT_BLOCK_CHARS: 6000,
  MAX_TABLES_IN_CONTEXT: 3,

  // Tables read from images by a vision model (vision/*). A table is kept
  // only when OCR of the same image confirms at least this share of its
  // values; its confidence scales with that share.
  VISION_MIN_GROUNDED: 0.5,
  VISION_MAX_TABLES_PER_IMAGE: 6,
  // Automatic runs (at upload or re-extract) stop after this many scanned
  // pages OCR'd or vision calls made; the rest wait for the user's
  // "Check remaining pages" click, which shows the estimated cost first.
  VISION_AUTO_MAX_PAGES: 25,
  VISION_AUTO_MAX_CALLS: 12,
  VISION_AUTO_MAX_FIGURES: 15,
  VISION_MAX_PAGES_ON_DEMAND: 300,
  // A PDF page with fewer text-layer words than this is treated as scanned.
  SCANNED_PAGE_MAX_WORDS: 10,
  // Rough USD per vision call (one ~2048px image at detail "high" plus the
  // transcription), used only for the estimate shown before a manual run.
  VISION_COST_PER_CALL_USD: 0.015,

  // Synthetic chunk indices start here (figures use 1_000_000).
  CHUNK_INDEX_BASE: 2_000_000,
  CHUNK_TEXT_CHARS: 6000,
};

export default config;
export const { MODEL_VISION, MODEL_QA } = config;
