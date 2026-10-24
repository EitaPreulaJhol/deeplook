-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "emailInfo" JSONB,
ADD COLUMN     "parentEntryId" TEXT;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_parentEntryId_fkey" FOREIGN KEY ("parentEntryId") REFERENCES "Entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

