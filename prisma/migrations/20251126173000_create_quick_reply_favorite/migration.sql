-- CreateTable
CREATE TABLE "QuickReplyFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "replyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuickReplyFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuickReplyFavorite_userId_replyId_key" ON "QuickReplyFavorite"("userId", "replyId");

-- CreateIndex
CREATE INDEX "QuickReplyFavorite_userId_idx" ON "QuickReplyFavorite"("userId");

-- CreateIndex
CREATE INDEX "QuickReplyFavorite_replyId_idx" ON "QuickReplyFavorite"("replyId");

-- AddForeignKey
ALTER TABLE "QuickReplyFavorite" ADD CONSTRAINT "QuickReplyFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReplyFavorite" ADD CONSTRAINT "QuickReplyFavorite_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "QuickReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

