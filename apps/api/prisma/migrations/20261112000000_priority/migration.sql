-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- AlterEnum
ALTER TYPE "EntryEventType" ADD VALUE 'PRIORITY_CHANGED';

-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "priority" "Priority" NOT NULL DEFAULT 'P3';

-- CreateIndex
CREATE INDEX "Entry_priority_status_statusChangedAt_idx" ON "Entry"("priority", "status", "statusChangedAt");

