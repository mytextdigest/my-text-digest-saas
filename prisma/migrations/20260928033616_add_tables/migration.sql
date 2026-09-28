-- AlterTable
ALTER TABLE "Chunk" ADD COLUMN     "table_id" TEXT;

-- AlterTable
ALTER TABLE "Figure" ADD COLUMN     "table_scan" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "derived_table_id" TEXT,
ADD COLUMN     "table_citations" JSONB;

-- AlterTable
ALTER TABLE "ProjectMessage" ADD COLUMN     "derived_table_id" TEXT,
ADD COLUMN     "table_citations" JSONB;

-- AlterTable
ALTER TABLE "DocumentComparison" ADD COLUMN     "table_pairs_json" JSONB;

-- CreateTable
CREATE TABLE "DocumentTable" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "table_index" INTEGER NOT NULL,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "sheet_name" TEXT,
    "source_type" TEXT NOT NULL,
    "title" TEXT,
    "title_source" TEXT,
    "description" TEXT,
    "caption" TEXT,
    "confidence" DOUBLE PRECISION,
    "row_count" INTEGER,
    "col_count" INTEGER,
    "raw_json" JSONB NOT NULL,
    "clean_json" JSONB,
    "edited_json" JSONB,
    "edited_at" TIMESTAMP(3),
    "grounding_issues" INTEGER NOT NULL DEFAULT 0,
    "signature" TEXT,
    "signature_embedding" JSONB,
    "chunk_id" TEXT,
    "figure_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableExtractionLog" (
    "document_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "tables_found" INTEGER NOT NULL DEFAULT 0,
    "candidates_seen" INTEGER NOT NULL DEFAULT 0,
    "skipped_low_conf" INTEGER NOT NULL DEFAULT 0,
    "skipped_for_cap" INTEGER NOT NULL DEFAULT 0,
    "repaired_by_llm" INTEGER NOT NULL DEFAULT 0,
    "vision_json" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "TableExtractionLog_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "DerivedTable" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "document_id" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "request_json" JSONB,
    "table_json" JSONB NOT NULL,
    "source_table_ids" TEXT[],
    "warnings_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DerivedTable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentTable_document_id_idx" ON "DocumentTable"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTable_document_id_table_index_key" ON "DocumentTable"("document_id", "table_index");

-- CreateIndex
CREATE INDEX "DerivedTable_project_id_idx" ON "DerivedTable"("project_id");

-- CreateIndex
CREATE INDEX "Chunk_table_id_idx" ON "Chunk"("table_id");

-- AddForeignKey
ALTER TABLE "DocumentTable" ADD CONSTRAINT "DocumentTable_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableExtractionLog" ADD CONSTRAINT "TableExtractionLog_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

