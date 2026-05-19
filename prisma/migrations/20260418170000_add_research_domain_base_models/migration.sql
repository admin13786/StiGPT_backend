-- Add base research-domain tables before graph relations.
-- This fills the gap between the Prisma schema and the checked-in migration chain.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'USER';

CREATE TABLE "Paper" (
    "id" TEXT NOT NULL,
    "documentId" TEXT,
    "title" VARCHAR(500) NOT NULL,
    "abstract" TEXT,
    "keywords" TEXT[],
    "year" INTEGER,
    "venue" VARCHAR(200),
    "doi" VARCHAR(100),
    "citationCount" INTEGER NOT NULL DEFAULT 0,
    "discipline" VARCHAR(100),
    "subField" VARCHAR(200),
    "language" VARCHAR(20),
    "filePath" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Paper_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Author" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "affiliation" VARCHAR(500),
    "email" VARCHAR(200),
    "hIndex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Author_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaperAuthor" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PaperAuthor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaperCitation" (
    "id" TEXT NOT NULL,
    "citingPaperId" TEXT NOT NULL,
    "citedPaperId" TEXT NOT NULL,

    CONSTRAINT "PaperCitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIWriteTask" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "researchField" VARCHAR(200),
    "keywords" TEXT[],
    "kbId" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'created',
    "outline" JSONB,
    "content" JSONB,
    "fullText" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIWriteTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AICheckTask" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "filePath" VARCHAR(500) NOT NULL,
    "kbId" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "content" TEXT,
    "report" JSONB,
    "overallSimilarity" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AICheckTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIReviewTask" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "filePath" VARCHAR(500) NOT NULL,
    "kbId" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "report" JSONB,
    "overallScore" DOUBLE PRECISION,
    "recommendation" VARCHAR(20),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIReviewTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Paper_title_idx" ON "Paper"("title");
CREATE INDEX "Paper_year_idx" ON "Paper"("year");
CREATE INDEX "Paper_venue_idx" ON "Paper"("venue");
CREATE INDEX "Paper_discipline_idx" ON "Paper"("discipline");
CREATE INDEX "Paper_status_idx" ON "Paper"("status");

CREATE INDEX "Author_name_idx" ON "Author"("name");
CREATE INDEX "Author_affiliation_idx" ON "Author"("affiliation");

CREATE UNIQUE INDEX "PaperAuthor_paperId_authorId_key" ON "PaperAuthor"("paperId", "authorId");
CREATE UNIQUE INDEX "PaperCitation_citingPaperId_citedPaperId_key" ON "PaperCitation"("citingPaperId", "citedPaperId");

CREATE INDEX "AIWriteTask_status_idx" ON "AIWriteTask"("status");
CREATE INDEX "AIWriteTask_createdAt_idx" ON "AIWriteTask"("createdAt");

CREATE INDEX "AICheckTask_status_idx" ON "AICheckTask"("status");
CREATE INDEX "AICheckTask_createdAt_idx" ON "AICheckTask"("createdAt");

CREATE INDEX "AIReviewTask_status_idx" ON "AIReviewTask"("status");
CREATE INDEX "AIReviewTask_createdAt_idx" ON "AIReviewTask"("createdAt");

ALTER TABLE "PaperAuthor"
    ADD CONSTRAINT "PaperAuthor_paperId_fkey"
    FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaperAuthor"
    ADD CONSTRAINT "PaperAuthor_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaperCitation"
    ADD CONSTRAINT "PaperCitation_citingPaperId_fkey"
    FOREIGN KEY ("citingPaperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaperCitation"
    ADD CONSTRAINT "PaperCitation_citedPaperId_fkey"
    FOREIGN KEY ("citedPaperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
