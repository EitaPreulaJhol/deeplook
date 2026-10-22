-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ENTRY_TRASHED';
ALTER TYPE "AuditAction" ADD VALUE 'ENTRY_RESTORED';
ALTER TYPE "AuditAction" ADD VALUE 'ENTRY_DELETED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntryEventType" ADD VALUE 'FILE_PURGED';
ALTER TYPE "EntryEventType" ADD VALUE 'TRASHED';
ALTER TYPE "EntryEventType" ADD VALUE 'RESTORED';

-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "filePurgedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Entry_deletedAt_idx" ON "Entry"("deletedAt");

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

