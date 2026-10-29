-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'READY', 'FAILED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'BACKUP_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'BACKUP_DOWNLOADED';
ALTER TYPE "AuditAction" ADD VALUE 'BACKUP_DELETED';

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'RUNNING',
    "includeSamples" BOOLEAN NOT NULL DEFAULT false,
    "step" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "key" TEXT,
    "size" BIGINT,
    "manifest" JSONB,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Backup_status_createdAt_idx" ON "Backup"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

