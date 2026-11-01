-- CreateEnum
CREATE TYPE "SandboxStatus" AS ENUM ('REQUESTED', 'PROVISIONING', 'RUNNING', 'STOPPING', 'STOPPED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "SandboxSession" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "analystId" TEXT NOT NULL,
    "node" TEXT NOT NULL,
    "vmid" INTEGER,
    "name" TEXT NOT NULL,
    "status" "SandboxStatus" NOT NULL DEFAULT 'REQUESTED',
    "phase" TEXT,
    "isoVolume" TEXT,
    "upid" TEXT,
    "ip" TEXT,
    "lastError" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SandboxSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SandboxSession_status_expiresAt_idx" ON "SandboxSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "SandboxSession_entryId_idx" ON "SandboxSession"("entryId");

-- CreateIndex
CREATE INDEX "SandboxSession_analystId_idx" ON "SandboxSession"("analystId");

-- AddForeignKey
ALTER TABLE "SandboxSession" ADD CONSTRAINT "SandboxSession_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SandboxSession" ADD CONSTRAINT "SandboxSession_analystId_fkey" FOREIGN KEY ("analystId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
