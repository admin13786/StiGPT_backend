-- 创建新的快捷回复分组表
CREATE TABLE "QuickReplyGroup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "gameId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "QuickReplyGroup_pkey" PRIMARY KEY ("id")
);

-- 创建新的快捷回复项表
CREATE TABLE "QuickReplyItem" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "shortcut" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "groupId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "QuickReplyItem_pkey" PRIMARY KEY ("id")
);

-- 创建索引
CREATE INDEX "QuickReplyGroup_gameId_idx" ON "QuickReplyGroup"("gameId");
CREATE INDEX "QuickReplyGroup_enabled_idx" ON "QuickReplyGroup"("enabled");
CREATE INDEX "QuickReplyGroup_sortOrder_idx" ON "QuickReplyGroup"("sortOrder");
CREATE INDEX "QuickReplyItem_groupId_idx" ON "QuickReplyItem"("groupId");
CREATE INDEX "QuickReplyItem_shortcut_idx" ON "QuickReplyItem"("shortcut");
CREATE INDEX "QuickReplyItem_usageCount_idx" ON "QuickReplyItem"("usageCount" DESC);

-- 添加外键约束
ALTER TABLE "QuickReplyGroup" ADD CONSTRAINT "QuickReplyGroup_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuickReplyItem" ADD CONSTRAINT "QuickReplyItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "QuickReplyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 注意：旧的 QuickReply 和 QuickReplyCategory 表暂时保留，后续可以手动删除
-- 如果需要迁移旧数据，可以运行以下 SQL（需要根据实际情况调整）：
-- 
-- INSERT INTO "QuickReplyGroup" ("name", "sortOrder", "gameId", "enabled", "createdAt", "updatedAt")
-- SELECT DISTINCT 
--   COALESCE(c.name, '未分类') as name,
--   COALESCE(c."sortOrder", 0) as "sortOrder",
--   NULL as "gameId",
--   COALESCE(c.enabled, true) as enabled,
--   NOW() as "createdAt",
--   NOW() as "updatedAt"
-- FROM "QuickReply" r
-- LEFT JOIN "QuickReplyCategory" c ON r."categoryId" = c.id
-- WHERE r."deletedAt" IS NULL
--   AND (c."deletedAt" IS NULL OR c.id IS NULL);
--
-- INSERT INTO "QuickReplyItem" ("content", "shortcut", "sortOrder", "usageCount", "groupId", "createdAt", "updatedAt")
-- SELECT 
--   r.content,
--   NULL as shortcut,
--   r."sortOrder",
--   r."usageCount",
--   g.id as "groupId",
--   r."createdAt",
--   r."updatedAt"
-- FROM "QuickReply" r
-- LEFT JOIN "QuickReplyCategory" c ON r."categoryId" = c.id
-- LEFT JOIN "QuickReplyGroup" g ON g.name = COALESCE(c.name, '未分类')
-- WHERE r."deletedAt" IS NULL;

