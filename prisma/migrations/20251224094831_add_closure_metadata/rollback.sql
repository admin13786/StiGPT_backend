-- 回滚脚本：移除工单自动关闭功能的数据库更改
-- 执行此脚本将撤销 20251224094831_add_closure_metadata 迁移

-- 警告：此操作将删除 closureMetadata 字段及其所有数据
-- 请在执行前确保已备份数据库

-- 删除索引
DROP INDEX IF EXISTS "SatisfactionRating_createdAt_idx";
DROP INDEX IF EXISTS "SatisfactionRating_agentId_createdAt_idx";
DROP INDEX IF EXISTS "Session_status_agentId_idx";
DROP INDEX IF EXISTS "Session_status_createdAt_idx";
DROP INDEX IF EXISTS "Ticket_status_createdAt_idx";
DROP INDEX IF EXISTS "Ticket_gameId_status_idx";
DROP INDEX IF EXISTS "Ticket_closedAt_idx";
DROP INDEX IF EXISTS "TicketMessage_ticketId_createdAt_idx";
DROP INDEX IF EXISTS "User_role_isOnline_deletedAt_idx";

-- 删除 closureMetadata 字段
ALTER TABLE "Ticket" DROP COLUMN IF EXISTS "closureMetadata";

-- 回滚完成
-- 注意：此操作不可逆，closureMetadata 中的数据将永久丢失
