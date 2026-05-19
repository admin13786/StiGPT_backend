-- AlterTable
ALTER TABLE "QuickReply" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "agentId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "QuickReply_isSystem_idx" ON "QuickReply"("isSystem");
