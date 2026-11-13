-- Office e PDF mais fundo (item 7.14; revisao de novembro, 3.2): o resultado do oletools por
-- amostra, numa fila persistida como a do capa.
CREATE TYPE "OfficeStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE "OfficeAnalysis" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "status" "OfficeStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "alerts" JSONB,
    "error" TEXT,
    "version" TEXT,
    "ms" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "OfficeAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfficeAnalysis_entryId_key" ON "OfficeAnalysis"("entryId");
CREATE INDEX "OfficeAnalysis_status_nextAttemptAt_idx" ON "OfficeAnalysis"("status", "nextAttemptAt");

ALTER TABLE "OfficeAnalysis" ADD CONSTRAINT "OfficeAnalysis_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
