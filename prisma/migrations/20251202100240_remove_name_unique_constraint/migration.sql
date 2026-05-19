-- 删除旧的 name 唯一索引
DROP INDEX IF EXISTS "QuickReplyCategory_name_key";

-- 创建组合唯一约束（name + creatorId），允许不同用户创建相同名称的分类
-- 注意：在 PostgreSQL 中，NULL 值在唯一约束中被视为不同的值，所以多个 creatorId 为 NULL 的记录可以存在
-- 但根据业务逻辑，所有分类都应该有 creatorId，所以这应该不是问题
CREATE UNIQUE INDEX IF NOT EXISTS "QuickReplyCategory_name_creatorId_key" ON "QuickReplyCategory"("name", "creatorId");

