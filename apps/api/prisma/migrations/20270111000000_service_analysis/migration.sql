-- Analises dos servicos novos (plans/novas-analises, itens 2, 4 e 6): emulacao, APK e configuracao
-- de familias, uma por amostra e tipo, na mesma fila (lib/service-analysis.ts).
-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('EMULATION', 'ANDROID', 'CONFIG');

-- CreateEnum
CREATE TYPE "ServiceAnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "ServiceAnalysis" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL,
    "status" "ServiceAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "options" JSONB,
    "result" JSONB,
    "alerts" JSONB,
    "iocs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "version" TEXT,
    "ms" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceAnalysis_kind_status_nextAttemptAt_idx" ON "ServiceAnalysis"("kind", "status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAnalysis_entryId_kind_key" ON "ServiceAnalysis"("entryId", "kind");

-- AddForeignKey
ALTER TABLE "ServiceAnalysis" ADD CONSTRAINT "ServiceAnalysis_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

