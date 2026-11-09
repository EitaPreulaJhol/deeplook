-- Desempacotar e extrair (item 7.8): um trabalho por amostra.
CREATE TYPE "UnpackStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE "UnpackJob" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "status" "UnpackStatus" NOT NULL DEFAULT 'PENDING',
    "unpacker" TEXT,
    "label" TEXT,
    "note" TEXT,
    "files" JSONB,
    "error" TEXT,
    "ms" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "UnpackJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnpackJob_entryId_key" ON "UnpackJob"("entryId");
CREATE INDEX "UnpackJob_status_nextAttemptAt_idx" ON "UnpackJob"("status", "nextAttemptAt");

ALTER TABLE "UnpackJob" ADD CONSTRAINT "UnpackJob_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
