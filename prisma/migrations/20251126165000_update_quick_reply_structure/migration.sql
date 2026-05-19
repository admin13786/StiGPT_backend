-- 更新 QuickReply 表结构以匹配新的 schema

-- 添加新字段
ALTER TABLE "QuickReply" ADD COLUMN IF NOT EXISTS "isGlobal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QuickReply" ADD COLUMN IF NOT EXISTS "creatorId" TEXT;
ALTER TABLE "QuickReply" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "QuickReply" ADD COLUMN IF NOT EXISTS "favoriteCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QuickReply" ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3);

-- 修改旧字段为可空（如果存在）
ALTER TABLE "QuickReply" ALTER COLUMN "keyword" DROP NOT NULL;
ALTER TABLE "QuickReply" ALTER COLUMN "agentId" DROP NOT NULL;

-- 迁移数据：将 agentId 迁移到 creatorId（如果 creatorId 为空）
UPDATE "QuickReply" 
SET "creatorId" = "agentId" 
WHERE "creatorId" IS NULL AND "agentId" IS NOT NULL;

-- 迁移数据：将 isSystem 迁移到 isGlobal（如果 isGlobal 为 false）
UPDATE "QuickReply" 
SET "isGlobal" = "isSystem" 
WHERE "isGlobal" = false AND "isSystem" IS NOT NULL;

-- 确保 categoryId 不为空（如果为空，设置为默认分类或删除）
-- 注意：这里假设至少有一个分类存在
DO $$
DECLARE
    default_category_id TEXT;
BEGIN
    -- 获取第一个全局分类作为默认分类
    SELECT id INTO default_category_id
    FROM "QuickReplyCategory"
    WHERE "isGlobal" = true AND "isActive" = true AND "deletedAt" IS NULL
    ORDER BY "sortOrder" ASC
    LIMIT 1;
    
    -- 如果没有全局分类，获取第一个分类
    IF default_category_id IS NULL THEN
        SELECT id INTO default_category_id
        FROM "QuickReplyCategory"
        WHERE "isActive" = true AND "deletedAt" IS NULL
        ORDER BY "sortOrder" ASC
        LIMIT 1;
    END IF;
    
    -- 更新 categoryId 为空的记录
    IF default_category_id IS NOT NULL THEN
        UPDATE "QuickReply"
        SET "categoryId" = default_category_id
        WHERE "categoryId" IS NULL AND "deletedAt" IS NULL;
    END IF;
END $$;

-- 创建新索引
CREATE INDEX IF NOT EXISTS "QuickReply_isGlobal_idx" ON "QuickReply"("isGlobal", "isActive", "deletedAt");
CREATE INDEX IF NOT EXISTS "QuickReply_creatorId_idx" ON "QuickReply"("creatorId", "isActive", "deletedAt");
CREATE INDEX IF NOT EXISTS "QuickReply_favoriteCount_idx" ON "QuickReply"("favoriteCount" DESC);
CREATE INDEX IF NOT EXISTS "QuickReply_lastUsedAt_idx" ON "QuickReply"("lastUsedAt" DESC);

-- 添加外键约束（如果不存在）
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'QuickReply_creatorId_fkey'
    ) THEN
        ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_creatorId_fkey" 
        FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 注意：保留旧字段（agentId, keyword, category, isSystem）以便后续数据迁移
-- 如果需要删除这些字段，可以在确认数据迁移成功后手动执行：
-- ALTER TABLE "QuickReply" DROP COLUMN IF EXISTS "agentId";
-- ALTER TABLE "QuickReply" DROP COLUMN IF EXISTS "keyword";
-- ALTER TABLE "QuickReply" DROP COLUMN IF EXISTS "category";
-- ALTER TABLE "QuickReply" DROP COLUMN IF EXISTS "isSystem";

