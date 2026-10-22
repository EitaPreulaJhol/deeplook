-- CreateEnum
CREATE TYPE "AvStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR');

-- CreateTable
CREATE TABLE "AntivirusScan" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "status" "AvStatus" NOT NULL,
    "signature" TEXT,
    "error" TEXT,
    "engine" TEXT,
    "dbVersion" INTEGER,
    "dbDate" TIMESTAMP(3),
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AntivirusScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AntivirusScan_entryId_key" ON "AntivirusScan"("entryId");

-- CreateIndex
CREATE INDEX "AntivirusScan_scannedAt_idx" ON "AntivirusScan"("scannedAt");

-- AddForeignKey
ALTER TABLE "AntivirusScan" ADD CONSTRAINT "AntivirusScan_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

