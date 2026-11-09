-- Detect It Easy (item 7.9): a identificacao vem no mesmo trabalho do desempacotamento, e as
-- regras de triagem ganham uma condicao sobre ela.
ALTER TABLE "UnpackJob" ADD COLUMN "detections" JSONB;
ALTER TABLE "UnpackJob" ADD COLUMN "dieVersion" TEXT;
ALTER TABLE "UnpackJob" ADD COLUMN "dieError" TEXT;

ALTER TYPE "TriageCondition" ADD VALUE 'DIE_DETECTION';
