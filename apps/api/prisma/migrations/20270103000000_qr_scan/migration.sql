-- QR code em imagens, PDFs e no print da pagina (plano pos-revisao, item 2.2): o que o leitor do
-- servico oletools achou, numa fila persistida como a do oletools.
CREATE TYPE "QrStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE "QrScan" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "status" "QrStatus" NOT NULL DEFAULT 'PENDING',
    "codes" JSONB,
    "pages" INTEGER,
    "error" TEXT,
    "ms" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "QrScan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QrScan_entryId_key" ON "QrScan"("entryId");
CREATE INDEX "QrScan_status_nextAttemptAt_idx" ON "QrScan"("status", "nextAttemptAt");

ALTER TABLE "QrScan" ADD CONSTRAINT "QrScan_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
