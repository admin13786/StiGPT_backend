/*
  Warnings:

  - You are about to drop the column `agentId` on the `QuickReply` table. All the data in the column will be lost.
  - You are about to drop the column `category` on the `QuickReply` table. All the data in the column will be lost.
  - You are about to drop the column `isSystem` on the `QuickReply` table. All the data in the column will be lost.
  - You are about to drop the column `keyword` on the `QuickReply` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `QuickReplyCategory` table. All the data in the column will be lost.
  - You are about to drop the `QuickReplyGroup` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `QuickReplyItem` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `categoryId` on table `QuickReply` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "QuickReply" DROP CONSTRAINT "QuickReply_agentId_fkey";

-- DropForeignKey
ALTER TABLE "QuickReply" DROP CONSTRAINT "QuickReply_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "QuickReplyGroup" DROP CONSTRAINT "QuickReplyGroup_gameId_fkey";

-- DropForeignKey
ALTER TABLE "QuickReplyItem" DROP CONSTRAINT "QuickReplyItem_groupId_fkey";

-- DropIndex
DROP INDEX "QuickReply_agentId_deletedAt_idx";

-- DropIndex
DROP INDEX "QuickReply_agentId_idx";

-- DropIndex
DROP INDEX "QuickReply_categoryId_idx";

-- DropIndex
DROP INDEX "QuickReply_category_idx";

-- DropIndex
DROP INDEX "QuickReply_favoriteCount_idx";

-- DropIndex
DROP INDEX "QuickReply_isSystem_idx";

-- DropIndex
DROP INDEX "QuickReply_lastUsedAt_idx";

-- DropIndex
DROP INDEX "QuickReplyCategory_enabled_idx";

-- DropIndex
DROP INDEX "QuickReplyCategory_sortOrder_idx";

-- AlterTable
ALTER TABLE "QuickReply" DROP COLUMN "agentId",
DROP COLUMN "category",
DROP COLUMN "isSystem",
DROP COLUMN "keyword",
ALTER COLUMN "categoryId" SET NOT NULL;

-- AlterTable
ALTER TABLE "QuickReplyCategory" DROP COLUMN "description";

-- DropTable
DROP TABLE "QuickReplyGroup";

-- DropTable
DROP TABLE "QuickReplyItem";

-- CreateIndex
CREATE INDEX "IssueType_requireDirectTransfer_idx" ON "IssueType"("requireDirectTransfer");

-- CreateIndex
CREATE INDEX "QuickReply_categoryId_isActive_deletedAt_idx" ON "QuickReply"("categoryId", "isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "QuickReply_usageCount_idx" ON "QuickReply"("usageCount");

-- CreateIndex
CREATE INDEX "QuickReply_favoriteCount_idx" ON "QuickReply"("favoriteCount");

-- CreateIndex
CREATE INDEX "QuickReply_lastUsedAt_idx" ON "QuickReply"("lastUsedAt");

-- AddForeignKey
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "QuickReplyCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "QuickReply_creatorId_idx" RENAME TO "QuickReply_creatorId_isActive_deletedAt_idx";

-- RenameIndex
ALTER INDEX "QuickReply_isGlobal_idx" RENAME TO "QuickReply_isGlobal_isActive_deletedAt_idx";

-- RenameIndex
ALTER INDEX "QuickReplyCategory_creatorId_idx" RENAME TO "QuickReplyCategory_creatorId_isActive_deletedAt_idx";

-- RenameIndex
ALTER INDEX "QuickReplyCategory_isGlobal_idx" RENAME TO "QuickReplyCategory_isGlobal_isActive_deletedAt_idx";
