-- CreateTable
CREATE TABLE "StigptChatModel" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'internal',
    "supportedRoutes" TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StigptChatModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StigptPageConfig" (
    "id" TEXT NOT NULL,
    "routeKey" VARCHAR(100) NOT NULL,
    "pageTitle" VARCHAR(200) NOT NULL,
    "assistantName" VARCHAR(100) NOT NULL,
    "welcomeMessage" TEXT NOT NULL,
    "inputPlaceholder" VARCHAR(255) NOT NULL,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StigptPageConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StigptConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "routeKey" VARCHAR(100) NOT NULL DEFAULT 'webIdx',
    "title" VARCHAR(255) NOT NULL DEFAULT 'New conversation',
    "modelId" TEXT,
    "personaId" VARCHAR(100),
    "kbId" TEXT,
    "providerConversationId" VARCHAR(255),
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StigptConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StigptMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" VARCHAR(30) NOT NULL,
    "content" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'completed',
    "citations" JSONB,
    "tokenUsage" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StigptMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StigptExample" (
    "id" TEXT NOT NULL,
    "routeKey" VARCHAR(100) NOT NULL,
    "modelId" TEXT,
    "title" VARCHAR(200) NOT NULL,
    "prompt" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StigptExample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StigptChatModel_code_key" ON "StigptChatModel"("code");

-- CreateIndex
CREATE INDEX "StigptChatModel_code_idx" ON "StigptChatModel"("code");

-- CreateIndex
CREATE INDEX "StigptChatModel_isActive_isDefault_idx" ON "StigptChatModel"("isActive", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "StigptPageConfig_routeKey_key" ON "StigptPageConfig"("routeKey");

-- CreateIndex
CREATE INDEX "StigptPageConfig_routeKey_isActive_idx" ON "StigptPageConfig"("routeKey", "isActive");

-- CreateIndex
CREATE INDEX "StigptConversation_userId_routeKey_idx" ON "StigptConversation"("userId", "routeKey");

-- CreateIndex
CREATE INDEX "StigptConversation_userId_lastMessageAt_idx" ON "StigptConversation"("userId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "StigptConversation_routeKey_createdAt_idx" ON "StigptConversation"("routeKey", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "StigptConversation_modelId_idx" ON "StigptConversation"("modelId");

-- CreateIndex
CREATE INDEX "StigptMessage_conversationId_createdAt_idx" ON "StigptMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "StigptMessage_role_createdAt_idx" ON "StigptMessage"("role", "createdAt");

-- CreateIndex
CREATE INDEX "StigptExample_routeKey_isActive_sortOrder_idx" ON "StigptExample"("routeKey", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "StigptExample_modelId_idx" ON "StigptExample"("modelId");

-- AddForeignKey
ALTER TABLE "StigptConversation" ADD CONSTRAINT "StigptConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StigptConversation" ADD CONSTRAINT "StigptConversation_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "StigptChatModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StigptMessage" ADD CONSTRAINT "StigptMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "StigptConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StigptExample" ADD CONSTRAINT "StigptExample_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "StigptChatModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
