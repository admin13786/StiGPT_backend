-- AlterTable
ALTER TABLE "Session"
ADD COLUMN     "transferAt" TIMESTAMP(3),
ADD COLUMN     "transferIssueTypeId" TEXT,
ADD COLUMN     "transferReason" TEXT;

