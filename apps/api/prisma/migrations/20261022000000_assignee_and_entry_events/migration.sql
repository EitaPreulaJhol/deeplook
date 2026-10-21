-- CreateEnum
CREATE TYPE "EntryEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'VERDICT_CHANGED', 'ASSIGNED', 'REPORT_CREATED', 'REPORT_PUBLISHED', 'SANDBOX_OPENED', 'SANDBOX_CLOSED');

-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "assigneeId" TEXT;

-- CreateTable
CREATE TABLE "EntryEvent" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "EntryEventType" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntryEvent_entryId_createdAt_idx" ON "EntryEvent"("entryId", "createdAt");

-- CreateIndex
CREATE INDEX "Entry_assigneeId_idx" ON "Entry"("assigneeId");

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryEvent" ADD CONSTRAINT "EntryEvent_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryEvent" ADD CONSTRAINT "EntryEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: amostras existentes ganham o evento "Amostra enviada" (o historico
-- nao comeca vazio). gen_random_uuid() e nativo a partir do PostgreSQL 13.
INSERT INTO "EntryEvent" ("id", "entryId", "actorId", "type", "createdAt")
SELECT gen_random_uuid()::text, "id", "ownerId", 'CREATED', "createdAt" FROM "Entry";
