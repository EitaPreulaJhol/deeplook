-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntryEventType" ADD VALUE 'MARKED_DUPLICATE';
ALTER TYPE "EntryEventType" ADD VALUE 'UNMARKED_DUPLICATE';

-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "duplicateOfId" TEXT;

-- CreateIndex
CREATE INDEX "Entry_duplicateOfId_idx" ON "Entry"("duplicateOfId");

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

