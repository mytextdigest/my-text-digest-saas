-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "billingInterval" TEXT NOT NULL DEFAULT 'month',
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "priceCents" INTEGER NOT NULL DEFAULT 0;
