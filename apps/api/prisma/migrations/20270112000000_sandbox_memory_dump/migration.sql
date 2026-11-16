-- Dumps de memoria dos processos da amostra no sandbox (plans/novas-analises, item 3).
-- CreateEnum
CREATE TYPE "MemoryDumpStatus" AS ENUM ('CAPTURING', 'STORED', 'ANALYZING', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'SANDBOX_MEMDUMP_DOWNLOADED';

-- AlterTable
ALTER TABLE "SandboxSession" ADD COLUMN     "memoryDump" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "memoryDumpAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SandboxMemoryDump" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "image" TEXT,
    "processGuid" TEXT,
    "status" "MemoryDumpStatus" NOT NULL DEFAULT 'CAPTURING',
    "storageKey" TEXT,
    "size" BIGINT,
    "storedSize" BIGINT,
    "sha256" TEXT,
    "error" TEXT,
    "result" JSONB,
    "children" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SandboxMemoryDump_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SandboxMemoryDump_sessionId_idx" ON "SandboxMemoryDump"("sessionId");

-- CreateIndex
CREATE INDEX "SandboxMemoryDump_status_idx" ON "SandboxMemoryDump"("status");

-- AddForeignKey
ALTER TABLE "SandboxMemoryDump" ADD CONSTRAINT "SandboxMemoryDump_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SandboxSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

