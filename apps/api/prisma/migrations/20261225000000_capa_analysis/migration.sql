-- Analise de funcoes (item 7.2): capa e FLOSS no servico capa, uma por amostra.
CREATE TYPE "CapaStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE "CapaAnalysis" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "status" "CapaStatus" NOT NULL DEFAULT 'PENDING',
    "capa" JSONB,
    "floss" JSONB,
    "attack" TEXT[],
    "iocCandidates" JSONB,
    "capaError" TEXT,
    "flossError" TEXT,
    "error" TEXT,
    "versions" JSONB,
    "ms" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CapaAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CapaAnalysis_entryId_key" ON "CapaAnalysis"("entryId");
CREATE INDEX "CapaAnalysis_status_nextAttemptAt_idx" ON "CapaAnalysis"("status", "nextAttemptAt");

ALTER TABLE "CapaAnalysis" ADD CONSTRAINT "CapaAnalysis_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
