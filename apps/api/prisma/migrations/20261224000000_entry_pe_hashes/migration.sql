-- Analise estatica do PE (item 7.1): imphash e Rich header ligam amostras na aba Relacionadas.
-- As amostras antigas sao preenchidas em segundo plano (src/lib/pe-backfill.ts).
ALTER TABLE "Entry" ADD COLUMN "imphash" TEXT;
ALTER TABLE "Entry" ADD COLUMN "richHash" TEXT;

CREATE INDEX "Entry_imphash_idx" ON "Entry"("imphash");
CREATE INDEX "Entry_richHash_idx" ON "Entry"("richHash");
