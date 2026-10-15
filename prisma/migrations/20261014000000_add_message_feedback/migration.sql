-- AlterTable
ALTER TABLE "Message" ADD COLUMN "feedback" INTEGER;
ALTER TABLE "Message" ADD COLUMN "feedback_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectMessage" ADD COLUMN "feedback" INTEGER;
ALTER TABLE "ProjectMessage" ADD COLUMN "feedback_at" TIMESTAMP(3);
