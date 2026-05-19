-- DropIndex
DROP INDEX "Session_status_priorityScore_queuedAt_idx";

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "kbId" TEXT,
ADD COLUMN     "personaId" TEXT,
ADD COLUMN     "ragEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "userId" TEXT NOT NULL,
    "aclScope" VARCHAR(20) NOT NULL DEFAULT 'internal',
    "aclUsers" JSONB,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "embeddingModel" VARCHAR(50) NOT NULL DEFAULT 'text-embedding-v2',
    "chunkSize" INTEGER NOT NULL DEFAULT 500,
    "chunkOverlap" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "kbId" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "filePath" VARCHAR(500) NOT NULL,
    "fileType" VARCHAR(10) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "uploadTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "vectorId" VARCHAR(100) NOT NULL,
    "headingPath" VARCHAR(500),
    "chunkType" VARCHAR(20) NOT NULL DEFAULT 'paragraph',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalHumanConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "vrmModelUrl" VARCHAR(500) NOT NULL,
    "avatarImage" VARCHAR(500),
    "voiceId" VARCHAR(50) NOT NULL,
    "voiceSpeed" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "voicePitch" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "voiceSettings" JSONB,
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "personality" VARCHAR(50),
    "kbIds" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DigitalHumanConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "kbId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "relevanceScore" DOUBLE PRECISION NOT NULL,
    "isHelpful" BOOLEAN,
    "isAccurate" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeBase_userId_idx" ON "KnowledgeBase"("userId");

-- CreateIndex
CREATE INDEX "KnowledgeBase_aclScope_idx" ON "KnowledgeBase"("aclScope");

-- CreateIndex
CREATE INDEX "KnowledgeBase_userId_deletedAt_idx" ON "KnowledgeBase"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "Document_kbId_idx" ON "Document"("kbId");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- CreateIndex
CREATE INDEX "Document_fileHash_idx" ON "Document"("fileHash");

-- CreateIndex
CREATE INDEX "Document_kbId_status_idx" ON "Document"("kbId", "status");

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");

-- CreateIndex
CREATE INDEX "DocumentChunk_vectorId_idx" ON "DocumentChunk"("vectorId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_documentId_chunkIndex_key" ON "DocumentChunk"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "DigitalHumanConfig_userId_idx" ON "DigitalHumanConfig"("userId");

-- CreateIndex
CREATE INDEX "DigitalHumanConfig_isActive_idx" ON "DigitalHumanConfig"("isActive");

-- CreateIndex
CREATE INDEX "DigitalHumanConfig_isDefault_idx" ON "DigitalHumanConfig"("isDefault");

-- CreateIndex
CREATE INDEX "Citation_sessionId_idx" ON "Citation"("sessionId");

-- CreateIndex
CREATE INDEX "Citation_messageId_idx" ON "Citation"("messageId");

-- CreateIndex
CREATE INDEX "Citation_kbId_idx" ON "Citation"("kbId");

-- CreateIndex
CREATE INDEX "Citation_documentId_idx" ON "Citation"("documentId");

-- CreateIndex
CREATE INDEX "Citation_createdAt_idx" ON "Citation"("createdAt");

-- CreateIndex
CREATE INDEX "Session_status_priorityScore_queuedAt_idx" ON "Session"("status", "priorityScore", "queuedAt");

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_kbId_fkey" FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
