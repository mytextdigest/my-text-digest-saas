-- AlterTable
ALTER TABLE "Message" ADD COLUMN "external_knowledge_query" TEXT;

-- AlterTable
ALTER TABLE "ProjectMessage" ADD COLUMN "external_knowledge_query" TEXT;
