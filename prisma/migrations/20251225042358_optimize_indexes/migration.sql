/*
 * 数据库索引优化迁移 (GameAI-CS)
 *
 * 优化目标：
 * 1. Session 排队查询: WHERE status='QUEUED' ORDER BY priorityScore DESC, queuedAt ASC
 * 2. Ticket 过期检查: WHERE status IN [...] AND updatedAt < ?
 * 3. Dashboard 统计: WHERE gameId=? AND createdAt BETWEEN ? AND ?
 *
 * 删除冗余索引：
 * - 被复合索引最左前缀覆盖的单列索引
 *
 * 注意：开发环境可直接执行，生产环境请参考下方的 CONCURRENTLY 版本
 */

-- =========================================================
-- 阶段 1: 删除冗余索引 (减少写入开销)
-- =========================================================

-- 删除 Message 单列索引 (被 [sessionId, createdAt] 复合索引覆盖)
DROP INDEX IF EXISTS "Message_sessionId_idx";

-- 删除 Session 旧的优先级索引 (被新的带 status 前缀的复合索引覆盖)
DROP INDEX IF EXISTS "Session_priorityScore_queuedAt_idx";

-- 删除 Session 单列状态索引 (被多个 status 开头的复合索引覆盖)
DROP INDEX IF EXISTS "Session_status_idx";

-- 删除 Ticket 单列状态索引 (被多个 status 开头的复合索引覆盖)
DROP INDEX IF EXISTS "Ticket_status_idx";

-- 删除 TicketMessage 单列索引 (被 [ticketId, createdAt] 复合索引覆盖)
DROP INDEX IF EXISTS "TicketMessage_ticketId_idx";


-- =========================================================
-- 阶段 2: 创建优化索引
-- =========================================================

-- Session 排队查询优化: WHERE status='QUEUED' ORDER BY priorityScore DESC, queuedAt ASC
CREATE INDEX "Session_status_priorityScore_queuedAt_idx"
ON "Session"("status", "priorityScore" DESC, "queuedAt" ASC);

-- Session 一致性检查和僵尸会话清理: WHERE status=? AND updatedAt < ?
CREATE INDEX "Session_status_updatedAt_idx"
ON "Session"("status", "updatedAt");

-- Ticket 过期工单定时任务: WHERE status IN [...] AND updatedAt < ?
CREATE INDEX "Ticket_status_updatedAt_idx"
ON "Ticket"("status", "updatedAt");

-- Dashboard 统计查询: WHERE gameId=? AND createdAt BETWEEN ? AND ?
CREATE INDEX "Ticket_gameId_createdAt_idx"
ON "Ticket"("gameId", "createdAt");


-- =========================================================
-- 生产环境版本 (使用 CONCURRENTLY 避免锁表，需单独执行)
-- =========================================================
/*
-- 注意：CONCURRENTLY 不能在事务中执行，需要手动逐条执行

-- 1. 先创建新索引 (不锁表)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Session_status_priorityScore_queuedAt_idx"
ON "Session"("status", "priorityScore" DESC, "queuedAt" ASC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Session_status_updatedAt_idx"
ON "Session"("status", "updatedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Ticket_status_updatedAt_idx"
ON "Ticket"("status", "updatedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Ticket_gameId_createdAt_idx"
ON "Ticket"("gameId", "createdAt");

-- 2. 验证新索引生效后，再删除冗余索引
DROP INDEX CONCURRENTLY IF EXISTS "Message_sessionId_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Session_priorityScore_queuedAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Session_status_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Ticket_status_idx";
DROP INDEX CONCURRENTLY IF EXISTS "TicketMessage_ticketId_idx";
*/
