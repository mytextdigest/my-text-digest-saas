/*
  Warnings:

  - A unique constraint covering the columns `[userId,key]` on the table `Setting` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Setting_userId_key_key" ON "Setting"("userId", "key");
