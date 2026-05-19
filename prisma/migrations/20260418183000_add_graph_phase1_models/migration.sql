-- Manual migration for scholarly graph phase 1.
-- `prisma migrate dev` currently fails in this environment with a schema engine error,
-- so this migration is checked in explicitly and can be applied with `prisma db execute`.

CREATE TABLE IF NOT EXISTS "Institution" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "normalizedName" VARCHAR(300) NOT NULL,
    "nameEn" VARCHAR(300),
    "country" VARCHAR(120),
    "city" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Topic" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "normalizedName" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuthorInstitution" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "startYear" INTEGER,
    "endYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorInstitution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthorInstitution_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AuthorInstitution_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PaperTopic" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperTopic_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaperTopic_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaperTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AuthorCollaboration" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,
    "paperCount" INTEGER NOT NULL DEFAULT 1,
    "lastYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorCollaboration_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthorCollaboration_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AuthorCollaboration_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Institution_normalizedName_key" ON "Institution"("normalizedName");
CREATE INDEX IF NOT EXISTS "Institution_name_idx" ON "Institution"("name");
CREATE INDEX IF NOT EXISTS "Institution_country_idx" ON "Institution"("country");

CREATE UNIQUE INDEX IF NOT EXISTS "Topic_normalizedName_key" ON "Topic"("normalizedName");
CREATE INDEX IF NOT EXISTS "Topic_name_idx" ON "Topic"("name");

CREATE UNIQUE INDEX IF NOT EXISTS "AuthorInstitution_authorId_institutionId_key" ON "AuthorInstitution"("authorId", "institutionId");
CREATE INDEX IF NOT EXISTS "AuthorInstitution_institutionId_idx" ON "AuthorInstitution"("institutionId");
CREATE INDEX IF NOT EXISTS "AuthorInstitution_authorId_isPrimary_idx" ON "AuthorInstitution"("authorId", "isPrimary");

CREATE UNIQUE INDEX IF NOT EXISTS "PaperTopic_paperId_topicId_key" ON "PaperTopic"("paperId", "topicId");
CREATE INDEX IF NOT EXISTS "PaperTopic_topicId_idx" ON "PaperTopic"("topicId");

CREATE UNIQUE INDEX IF NOT EXISTS "AuthorCollaboration_authorId_collaboratorId_key" ON "AuthorCollaboration"("authorId", "collaboratorId");
CREATE INDEX IF NOT EXISTS "AuthorCollaboration_collaboratorId_idx" ON "AuthorCollaboration"("collaboratorId");
CREATE INDEX IF NOT EXISTS "AuthorCollaboration_paperCount_idx" ON "AuthorCollaboration"("paperCount");
