-- Magika no trabalho de identificacao (plans/analise-estatica-ampliada, item 22).
ALTER TABLE "UnpackJob" ADD COLUMN "magika" JSONB;
ALTER TYPE "TriageCondition" ADD VALUE 'MAGIKA';
