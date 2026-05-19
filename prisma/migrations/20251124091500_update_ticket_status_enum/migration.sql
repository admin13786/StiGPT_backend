-- Convert legacy statuses to new set
UPDATE "Ticket" SET "status" = 'WAITING' WHERE "status" = 'NEW';
UPDATE "Ticket" SET "status" = 'RESOLVED' WHERE "status" = 'CLOSED';

-- Recreate enum without NEW/CLOSED
CREATE TYPE "TicketStatus_new" AS ENUM ('IN_PROGRESS','WAITING','RESOLVED');

ALTER TABLE "Ticket"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "TicketStatus_new" USING ("status"::text::"TicketStatus_new"),
  ALTER COLUMN "status" SET DEFAULT 'IN_PROGRESS';

DROP TYPE "TicketStatus";
ALTER TYPE "TicketStatus_new" RENAME TO "TicketStatus";

