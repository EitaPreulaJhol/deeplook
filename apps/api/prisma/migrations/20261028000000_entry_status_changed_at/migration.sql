-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Amostras existentes: entrada no status atual = ultima mudanca de status do
-- historico; sem mudancas, a data de envio.
UPDATE "Entry" e
SET "statusChangedAt" = COALESCE(
  (
    SELECT MAX(ev."createdAt")
    FROM "EntryEvent" ev
    WHERE ev."entryId" = e."id" AND ev."type" = 'STATUS_CHANGED'
  ),
  e."createdAt"
);

-- CreateIndex
CREATE INDEX "Entry_status_statusChangedAt_idx" ON "Entry"("status", "statusChangedAt");

-- Mantem "statusChangedAt" em qualquer mudanca de status (triagem, atualizacao em
-- massa, publicacao de relatorio...), sem depender de cada rota da API. Os
-- timestamps do Prisma sao UTC sem fuso: grava now() em UTC.
CREATE FUNCTION "entry_status_changed_at"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    NEW."statusChangedAt" := (now() AT TIME ZONE 'UTC');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Entry_status_changed_at"
BEFORE UPDATE OF "status" ON "Entry"
FOR EACH ROW EXECUTE FUNCTION "entry_status_changed_at"();
