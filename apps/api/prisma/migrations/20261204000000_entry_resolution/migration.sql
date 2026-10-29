-- AlterEnum
ALTER TYPE "EntryEventType" ADD VALUE 'RESOLUTION_SET';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'RESOLUTION';

-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "resolution" TEXT;

