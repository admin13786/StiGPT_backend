-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "closureMetadata" JSONB;

-- CreateIndex
CREATE INDEX "SatisfactionRating_createdAt_idx" ON "SatisfactionRating"("createdAt");

-- CreateIndex
CREATE INDEX "SatisfactionRating_agentId_createdAt_idx" ON "SatisfactionRating"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "Session_status_agentId_idx" ON "Session"("status", "agentId");

-- CreateIndex
CREATE INDEX "Session_status_createdAt_idx" ON "Session"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_status_createdAt_idx" ON "Ticket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_gameId_status_idx" ON "Ticket"("gameId", "status");

-- CreateIndex
CREATE INDEX "Ticket_closedAt_idx" ON "Ticket"("closedAt");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "User_role_isOnline_deletedAt_idx" ON "User"("role", "isOnline", "deletedAt");
