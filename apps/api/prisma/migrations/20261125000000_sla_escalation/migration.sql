-- CreateEnum
CREATE TYPE "SlaStage" AS ENUM ('WARN', 'LATE');

-- AlterEnum
ALTER TYPE "EntryEventType" ADD VALUE 'SLA_WARN';
ALTER TYPE "EntryEventType" ADD VALUE 'SLA_LATE';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SLA_WARN';
ALTER TYPE "NotificationType" ADD VALUE 'SLA_LATE';

-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "slaStage" "SlaStage";

-- Escalonamento por prazo (item 73): mudou de status, os avisos de prazo
-- recomecam (o mesmo trigger que mantem "statusChangedAt").
CREATE OR REPLACE FUNCTION "entry_status_changed_at"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    NEW."statusChangedAt" := (now() AT TIME ZONE 'UTC');
    NEW."slaStage" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
