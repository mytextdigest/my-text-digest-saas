-- AlterTable
ALTER TABLE "Topic" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TopicDocument" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "value" TEXT,
    "unit" TEXT,
    "period" TEXT,
    "embedding" JSONB,
    "mention_count" INTEGER NOT NULL DEFAULT 0,
    "document_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityDocument" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityMention" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "mention_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "source_entity_id" TEXT NOT NULL,
    "target_entity_id" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "description" TEXT,
    "document_id" TEXT NOT NULL,
    "chunk_id" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "is_inferred" BOOLEAN NOT NULL DEFAULT false,
    "insight_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphExtractionLog" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "chunks_total" INTEGER NOT NULL DEFAULT 0,
    "chunks_done" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "GraphExtractionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphInsight" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "document_id" TEXT,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "entity_ids" JSONB NOT NULL,
    "relationship_ids" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Entity_project_id_idx" ON "Entity"("project_id");

-- CreateIndex
CREATE INDEX "Entity_project_id_normalized_name_idx" ON "Entity"("project_id", "normalized_name");

-- CreateIndex
CREATE INDEX "EntityDocument_document_id_idx" ON "EntityDocument"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "EntityDocument_entity_id_document_id_key" ON "EntityDocument"("entity_id", "document_id");

-- CreateIndex
CREATE INDEX "EntityMention_entity_id_idx" ON "EntityMention"("entity_id");

-- CreateIndex
CREATE INDEX "EntityMention_chunk_id_idx" ON "EntityMention"("chunk_id");

-- CreateIndex
CREATE INDEX "Relationship_source_entity_id_idx" ON "Relationship"("source_entity_id");

-- CreateIndex
CREATE INDEX "Relationship_target_entity_id_idx" ON "Relationship"("target_entity_id");

-- CreateIndex
CREATE INDEX "Relationship_project_id_idx" ON "Relationship"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "GraphExtractionLog_document_id_key" ON "GraphExtractionLog"("document_id");

-- CreateIndex
CREATE INDEX "GraphInsight_document_id_idx" ON "GraphInsight"("document_id");

-- CreateIndex
CREATE INDEX "GraphInsight_project_id_idx" ON "GraphInsight"("project_id");

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityDocument" ADD CONSTRAINT "EntityDocument_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityDocument" ADD CONSTRAINT "EntityDocument_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMention" ADD CONSTRAINT "EntityMention_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMention" ADD CONSTRAINT "EntityMention_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "Chunk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMention" ADD CONSTRAINT "EntityMention_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_source_entity_id_fkey" FOREIGN KEY ("source_entity_id") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_target_entity_id_fkey" FOREIGN KEY ("target_entity_id") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "Chunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphExtractionLog" ADD CONSTRAINT "GraphExtractionLog_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphInsight" ADD CONSTRAINT "GraphInsight_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphInsight" ADD CONSTRAINT "GraphInsight_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

