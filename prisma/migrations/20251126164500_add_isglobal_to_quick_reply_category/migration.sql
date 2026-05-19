-- AlterTable: 添加 isGlobal 和 creatorId 字段到 QuickReplyCategory
ALTER TABLE "QuickReplyCategory" ADD COLUMN IF NOT EXISTS "isGlobal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QuickReplyCategory" ADD COLUMN IF NOT EXISTS "creatorId" TEXT;

-- 重命名 enabled 列为 isActive（如果存在）
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'QuickReplyCategory' AND column_name = 'enabled') THEN
        ALTER TABLE "QuickReplyCategory" RENAME COLUMN "enabled" TO "isActive";
    END IF;
END $$;

-- 如果 isActive 列不存在，则创建它
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'QuickReplyCategory' AND column_name = 'isActive') THEN
        ALTER TABLE "QuickReplyCategory" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
    END IF;
END $$;

-- 创建索引（如果不存在）
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'QuickReplyCategory_isGlobal_idx') THEN
        CREATE INDEX "QuickReplyCategory_isGlobal_idx" ON "QuickReplyCategory"("isGlobal", "isActive", "deletedAt");
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'QuickReplyCategory_creatorId_idx') THEN
        CREATE INDEX "QuickReplyCategory_creatorId_idx" ON "QuickReplyCategory"("creatorId", "isActive", "deletedAt");
    END IF;
END $$;

-- 添加外键约束（如果不存在）
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'QuickReplyCategory_creatorId_fkey'
    ) THEN
        ALTER TABLE "QuickReplyCategory" ADD CONSTRAINT "QuickReplyCategory_creatorId_fkey" 
        FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

