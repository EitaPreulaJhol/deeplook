-- Pseudo-C de todas as funcoes do Ghidra (plans/ghidra-pseudo-c): o texto fica no MinIO, fora de
-- samples/; aqui, o indice com o deslocamento de cada funcao nele.
ALTER TABLE "GhidraAnalysis" ADD COLUMN     "pseudoCapHit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pseudoDeadlineHit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pseudoError" TEXT,
ADD COLUMN     "pseudoKey" TEXT,
ADD COLUMN     "pseudoSize" INTEGER,
ADD COLUMN     "pseudoTotal" INTEGER;

CREATE TABLE "GhidraFunction" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "entry" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "complexity" INTEGER NOT NULL,
    "isEntryPoint" BOOLEAN NOT NULL,
    "library" BOOLEAN NOT NULL,
    "sensitive" TEXT[],
    "apis" TEXT[],
    "callers" TEXT[],
    "callerCount" INTEGER NOT NULL,
    "callees" TEXT[],
    "calleeCount" INTEGER NOT NULL,
    "cOffset" INTEGER,
    "cLength" INTEGER,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "skipped" TEXT,
    "error" TEXT,

    CONSTRAINT "GhidraFunction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GhidraFunction_analysisId_rank_idx" ON "GhidraFunction"("analysisId", "rank");

CREATE UNIQUE INDEX "GhidraFunction_analysisId_entry_key" ON "GhidraFunction"("analysisId", "entry");

ALTER TABLE "GhidraFunction" ADD CONSTRAINT "GhidraFunction_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "GhidraAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

