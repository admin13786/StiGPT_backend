ALTER TABLE "AIWriteTask" ADD COLUMN "userId" TEXT;
ALTER TABLE "AICheckTask" ADD COLUMN "userId" TEXT;
ALTER TABLE "AIReviewTask" ADD COLUMN "userId" TEXT;

ALTER TABLE "AIWriteTask"
ADD CONSTRAINT "AIWriteTask_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AICheckTask"
ADD CONSTRAINT "AICheckTask_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AIReviewTask"
ADD CONSTRAINT "AIReviewTask_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AIWriteTask_userId_updatedAt_idx" ON "AIWriteTask"("userId", "updatedAt");
CREATE INDEX "AICheckTask_userId_createdAt_idx" ON "AICheckTask"("userId", "createdAt");
CREATE INDEX "AIReviewTask_userId_createdAt_idx" ON "AIReviewTask"("userId", "createdAt");
