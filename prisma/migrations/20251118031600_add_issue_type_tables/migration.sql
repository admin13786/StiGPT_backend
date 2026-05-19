-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "allowManualTransfer" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "difyConversationId" TEXT,
ADD COLUMN     "difyStatus" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "priorityScore" INTEGER NOT NULL DEFAULT 50,
ALTER COLUMN "status" SET DEFAULT 'IN_PROGRESS';

-- CreateTable
CREATE TABLE "IssueType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priorityWeight" INTEGER NOT NULL DEFAULT 50,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IssueType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketIssueType" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "issueTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketIssueType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueType_enabled_sortOrder_idx" ON "IssueType"("enabled", "sortOrder");

-- CreateIndex
CREATE INDEX "IssueType_priorityWeight_idx" ON "IssueType"("priorityWeight");

-- CreateIndex
CREATE INDEX "TicketIssueType_ticketId_idx" ON "TicketIssueType"("ticketId");

-- CreateIndex
CREATE INDEX "TicketIssueType_issueTypeId_idx" ON "TicketIssueType"("issueTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketIssueType_ticketId_issueTypeId_key" ON "TicketIssueType"("ticketId", "issueTypeId");

-- CreateIndex
CREATE INDEX "Ticket_priorityScore_idx" ON "Ticket"("priorityScore");

-- AddForeignKey
ALTER TABLE "TicketIssueType" ADD CONSTRAINT "TicketIssueType_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketIssueType" ADD CONSTRAINT "TicketIssueType_issueTypeId_fkey" FOREIGN KEY ("issueTypeId") REFERENCES "IssueType"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 插入预设问题类型
INSERT INTO "IssueType" ("id", "name", "description", "priorityWeight", "sortOrder", "icon", "createdAt", "updatedAt") VALUES
('issue-type-01', '充值未到账', '充值后长时间未到账', 95, 1, '💰', NOW(), NOW()),
('issue-type-02', '账号被盗', '账号被他人登录或盗用', 90, 2, '🔒', NOW(), NOW()),
('issue-type-03', '游戏无法登录', '无法正常登录游戏', 85, 3, '🚫', NOW(), NOW()),
('issue-type-04', '道具丢失', '游戏内道具或装备丢失', 75, 5, '📦', NOW(), NOW()),
('issue-type-05', '游戏闪退/卡顿', '游戏运行不稳定', 70, 4, '⚠️', NOW(), NOW()),
('issue-type-06', '游戏BUG', '游戏功能异常或BUG', 65, 7, '🐛', NOW(), NOW()),
('issue-type-07', '活动奖励问题', '活动奖励未发放或错误', 60, 6, '🎁', NOW(), NOW()),
('issue-type-08', '账号封禁申诉', '账号被封禁，申请解封', 80, 8, '🔓', NOW(), NOW()),
('issue-type-09', '实名认证问题', '实名认证相关问题', 55, 9, '📝', NOW(), NOW()),
('issue-type-10', '好友/社交问题', '好友系统、聊天等社交功能', 40, 10, '👥', NOW(), NOW()),
('issue-type-11', '游戏玩法咨询', '游戏玩法、攻略咨询', 30, 11, '❓', NOW(), NOW()),
('issue-type-12', '其他问题', '其他未分类问题', 50, 12, '📌', NOW(), NOW());
