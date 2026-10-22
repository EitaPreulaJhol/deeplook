-- CreateEnum
CREATE TYPE "ReputationKind" AS ENUM ('HASH', 'DOMAIN', 'IP');

-- CreateEnum
CREATE TYPE "ReputationStatus" AS ENUM ('PENDING', 'FOUND', 'NOT_FOUND', 'ERROR');

-- CreateTable
CREATE TABLE "ReputationResult" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "kind" "ReputationKind" NOT NULL,
    "indicator" TEXT NOT NULL,
    "status" "ReputationStatus" NOT NULL,
    "verdict" "Verdict" NOT NULL DEFAULT 'UNKNOWN',
    "summary" TEXT NOT NULL,
    "link" TEXT,
    "details" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReputationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReputationResult_service_indicator_checkedAt_idx" ON "ReputationResult"("service", "indicator", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReputationResult_entryId_service_key" ON "ReputationResult"("entryId", "service");

-- AddForeignKey
ALTER TABLE "ReputationResult" ADD CONSTRAINT "ReputationResult_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

