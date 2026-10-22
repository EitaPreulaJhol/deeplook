-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED');

-- AlterEnum (PostgreSQL 12+ aceita varios ADD VALUE na mesma migracao)
ALTER TYPE "EntryEventType" ADD VALUE 'REPORT_SUBMITTED';
ALTER TYPE "EntryEventType" ADD VALUE 'REPORT_APPROVED';
ALTER TYPE "EntryEventType" ADD VALUE 'REPORT_RETURNED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REPORT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'REPORT_RETURNED';

-- AlterTable: o booleano "published" vira o status (publicados continuam publicados).
ALTER TABLE "Report"
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "submittedAt" TIMESTAMP(3);

UPDATE "Report" SET "status" = 'PUBLISHED' WHERE "published" = true;

ALTER TABLE "Report" DROP COLUMN "published";

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
