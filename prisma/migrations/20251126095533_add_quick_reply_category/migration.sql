-- CreateTable
CREATE TABLE "QuickReplyCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "QuickReplyCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuickReplyCategory_name_key" ON "QuickReplyCategory"("name");

-- CreateIndex
CREATE INDEX "QuickReplyCategory_enabled_idx" ON "QuickReplyCategory"("enabled");

-- CreateIndex
CREATE INDEX "QuickReplyCategory_sortOrder_idx" ON "QuickReplyCategory"("sortOrder");

-- AlterTable: 添加 categoryId 字段
ALTER TABLE "QuickReply" ADD COLUMN "categoryId" TEXT;

-- CreateIndex: 为 categoryId 创建索引
CREATE INDEX "QuickReply_categoryId_idx" ON "QuickReply"("categoryId");

-- AddForeignKey: 添加外键约束
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "QuickReplyCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 数据迁移：将现有的 category 字符串值迁移到 QuickReplyCategory
-- 1. 提取所有唯一的分类名称并创建分类记录
DO $$
DECLARE
    category_name TEXT;
    category_id TEXT;
    reply_record RECORD;
BEGIN
    -- 遍历所有唯一的分类名称
    FOR category_name IN 
        SELECT DISTINCT category 
        FROM "QuickReply" 
        WHERE category IS NOT NULL 
        AND category != ''
        AND "deletedAt" IS NULL
    LOOP
        -- 检查分类是否已存在
        SELECT id INTO category_id
        FROM "QuickReplyCategory"
        WHERE name = category_name
        AND "deletedAt" IS NULL
        LIMIT 1;
        
        -- 如果不存在，创建新分类
        IF category_id IS NULL THEN
            INSERT INTO "QuickReplyCategory" (id, name, "enabled", "sortOrder", "createdAt", "updatedAt")
            VALUES (gen_random_uuid()::TEXT, category_name, true, 0, NOW(), NOW())
            RETURNING id INTO category_id;
        END IF;
        
        -- 更新所有使用该分类的快捷回复
        UPDATE "QuickReply"
        SET "categoryId" = category_id
        WHERE category = category_name
        AND "categoryId" IS NULL
        AND "deletedAt" IS NULL;
    END LOOP;
END $$;

-- AlterTable: 删除旧的 category 字段（在数据迁移完成后）
-- 注意：暂时保留 category 字段，等确认数据迁移成功后再删除
-- ALTER TABLE "QuickReply" DROP COLUMN "category";

-- DropIndex: 删除旧的 category 索引（在数据迁移完成后）
-- DROP INDEX IF EXISTS "QuickReply_category_idx";

