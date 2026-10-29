-- CreateEnum
CREATE TYPE "TriageCondition" AS ENUM ('DETECTED_TYPE', 'YARA', 'ANTIVIRUS', 'DOMAIN', 'SENDER', 'MACRO', 'DISGUISED', 'SCRIPT_RISK', 'DOCUMENT_RISK', 'LNK');

-- AlterEnum
ALTER TYPE "EntryEventType" ADD VALUE 'TRIAGE_RULE';

-- CreateTable
CREATE TABLE "TriageRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "condition" "TriageCondition" NOT NULL,
    "value" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" "Priority",
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriageRule_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TriageRule" ADD CONSTRAINT "TriageRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

