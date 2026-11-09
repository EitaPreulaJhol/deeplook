-- Analise com o Ghidra (item 7.3), sob demanda, uma por amostra.
CREATE TYPE "GhidraStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE "GhidraAnalysis" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" "GhidraStatus" NOT NULL DEFAULT 'PENDING',
    "summary" JSONB,
    "gzfKey" TEXT,
    "gzfSize" INTEGER,
    "gzfError" TEXT,
    "error" TEXT,
    "version" TEXT,
    "ms" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GhidraAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GhidraAnalysis_entryId_key" ON "GhidraAnalysis"("entryId");
CREATE INDEX "GhidraAnalysis_status_nextAttemptAt_idx" ON "GhidraAnalysis"("status", "nextAttemptAt");

ALTER TABLE "GhidraAnalysis" ADD CONSTRAINT "GhidraAnalysis_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GhidraAnalysis" ADD CONSTRAINT "GhidraAnalysis_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
