-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "image_job_json" JSONB,
ADD COLUMN     "image_progress" TEXT;

-- AlterTable
ALTER TABLE "ProjectMessage" ADD COLUMN     "image_job_json" JSONB,
ADD COLUMN     "image_progress" TEXT;

-- CreateTable
CREATE TABLE "ChatAttachment" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "message_kind" TEXT NOT NULL,
    "message_id" TEXT,
    "direction" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "original_name" TEXT,
    "mime" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "size_bytes" INTEGER,
    "saved_document_id" TEXT,
    "generation_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatAttachment_message_kind_message_id_idx" ON "ChatAttachment"("message_kind", "message_id");

-- CreateIndex
CREATE INDEX "ChatAttachment_user_id_created_at_idx" ON "ChatAttachment"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

