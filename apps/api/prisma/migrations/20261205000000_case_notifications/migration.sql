-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CASE_MENTION';
ALTER TYPE "NotificationType" ADD VALUE 'CASE_COMMENT';
ALTER TYPE "NotificationType" ADD VALUE 'CASE_ENTRY_ADDED';
ALTER TYPE "NotificationType" ADD VALUE 'CASE_ENTRY_REMOVED';
ALTER TYPE "NotificationType" ADD VALUE 'CASE_ASSIGNED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "caseId" TEXT,
ALTER COLUMN "entryId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sempre de uma amostra ou de um caso (item 89).
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_target_check" CHECK ("entryId" IS NOT NULL OR "caseId" IS NOT NULL);
