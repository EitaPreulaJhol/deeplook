-- CreateEnum
CREATE TYPE "YaraPackReleaseStatus" AS ENUM ('APPLIED', 'HELD', 'ROLLED_BACK', 'DISMISSED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'YARA_PACK_UPDATED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'YARA_PACK_UPDATE';

-- AlterTable
ALTER TABLE "YaraRule" ADD COLUMN     "packFile" TEXT;

-- CreateTable
CREATE TABLE "YaraPackRelease" (
    "id" TEXT NOT NULL,
    "pack" TEXT NOT NULL,
    "commit" TEXT NOT NULL,
    "commitDate" TIMESTAMP(3) NOT NULL,
    "status" "YaraPackReleaseStatus" NOT NULL,
    "summary" JSONB NOT NULL,
    "reasons" JSONB,
    "undo" JSONB,
    "canRollback" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "YaraPackRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "YaraPackRelease_pack_createdAt_idx" ON "YaraPackRelease"("pack", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "YaraRule_pack_packFile_key" ON "YaraRule"("pack", "packFile");


-- Aviso de pacote YARA nao tem amostra nem caso; o tipo vai como texto porque o valor
-- novo do enum nao pode ser usado na mesma transacao que o cria.
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_target_check";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_target_check" CHECK ("entryId" IS NOT NULL OR "caseId" IS NOT NULL OR "type"::text = 'YARA_PACK_UPDATE');
