-- Captura de rede do sandbox (plano pos-revisao, item 5.4): o pcap que o netcap gravou a partir do
-- sniffer do MikroTik e o que o Suricata achou nele, numa fila persistida como as outras.
CREATE TYPE "NetworkCaptureStatus" AS ENUM ('CAPTURING', 'STORED', 'FAILED');
CREATE TYPE "IdsStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

CREATE TABLE "NetworkCapture" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "mac" TEXT NOT NULL,
    "status" "NetworkCaptureStatus" NOT NULL DEFAULT 'CAPTURING',
    "error" TEXT,
    "storageKey" TEXT,
    "bytes" INTEGER,
    "packets" INTEGER,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "idsStatus" "IdsStatus",
    "idsResult" JSONB,
    "idsError" TEXT,
    "idsMs" INTEGER,
    "idsAttempts" INTEGER NOT NULL DEFAULT 0,
    "idsNextAttemptAt" TIMESTAMP(3),
    "idsQueuedAt" TIMESTAMP(3),
    "idsStartedAt" TIMESTAMP(3),
    "idsFinishedAt" TIMESTAMP(3),

    CONSTRAINT "NetworkCapture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NetworkCapture_sessionId_key" ON "NetworkCapture"("sessionId");
CREATE INDEX "NetworkCapture_status_idx" ON "NetworkCapture"("status");
CREATE INDEX "NetworkCapture_idsStatus_idsNextAttemptAt_idx" ON "NetworkCapture"("idsStatus", "idsNextAttemptAt");

ALTER TABLE "NetworkCapture" ADD CONSTRAINT "NetworkCapture_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SandboxSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Download do pcap fica na auditoria.
ALTER TYPE "AuditAction" ADD VALUE 'SANDBOX_PCAP_DOWNLOADED' AFTER 'ENTRY_DOWNLOADED';
