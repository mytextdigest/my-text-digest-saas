-- AlterTable
ALTER TABLE "Document" ADD COLUMN "last_error" TEXT,
ADD COLUMN "failed_stage" TEXT,
ADD COLUMN "failed_at" TIMESTAMP(3);
