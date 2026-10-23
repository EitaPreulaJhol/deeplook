-- CreateEnum
CREATE TYPE "YaraStatus" AS ENUM ('PENDING', 'CLEAN', 'MATCHED', 'ERROR');

-- AlterEnum


ALTER TYPE "AuditAction" ADD VALUE 'YARA_RULE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'YARA_RULE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'YARA_RULE_DELETED';

-- CreateTable
CREATE TABLE "YaraRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YaraRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YaraScan" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "status" "YaraStatus" NOT NULL,
    "matches" JSONB NOT NULL DEFAULT '[]',
    "rulesCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YaraScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YaraRule_name_key" ON "YaraRule"("name");

-- CreateIndex
CREATE UNIQUE INDEX "YaraScan_entryId_key" ON "YaraScan"("entryId");

-- AddForeignKey
ALTER TABLE "YaraRule" ADD CONSTRAINT "YaraRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YaraRule" ADD CONSTRAINT "YaraRule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YaraScan" ADD CONSTRAINT "YaraScan_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

