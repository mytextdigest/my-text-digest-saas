-- CreateTable
CREATE TABLE "Figure" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "figure_index" INTEGER NOT NULL,
    "page_number" INTEGER,
    "source_type" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "format" TEXT,
    "caption" TEXT,
    "ocr_text" TEXT,
    "chunk_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Figure_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Figure" ADD CONSTRAINT "Figure_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Figure" ADD CONSTRAINT "Figure_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "Chunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
