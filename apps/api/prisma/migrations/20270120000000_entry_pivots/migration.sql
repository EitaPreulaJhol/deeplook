-- Pivos que ligam amostras na aba Relacionadas (plans/analise-estatica-ampliada): PDB, authentihash,
-- ExportHash, modulo Go, DocumentID do XMP...
CREATE TABLE "EntryPivot" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "EntryPivot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EntryPivot_entryId_kind_value_key" ON "EntryPivot"("entryId", "kind", "value");
CREATE INDEX "EntryPivot_kind_value_idx" ON "EntryPivot"("kind", "value");

ALTER TABLE "EntryPivot" ADD CONSTRAINT "EntryPivot_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
