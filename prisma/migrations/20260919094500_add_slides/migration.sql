-- CreateTable
CREATE TABLE "SlideDeck" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "title" TEXT,
    "theme" TEXT,
    "slide_count" INTEGER NOT NULL DEFAULT 0,
    "s3_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "error_message" TEXT,
    "outline_json" JSONB,
    "brand_kit_json" JSONB,
    "custom_prompt" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlideDeck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlideImage" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "format" TEXT,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "prompt" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlideImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlideDeck_document_id_idx" ON "SlideDeck"("document_id");

-- CreateIndex
CREATE INDEX "SlideImage_document_id_idx" ON "SlideImage"("document_id");

-- AddForeignKey
ALTER TABLE "SlideDeck" ADD CONSTRAINT "SlideDeck_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlideImage" ADD CONSTRAINT "SlideImage_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
