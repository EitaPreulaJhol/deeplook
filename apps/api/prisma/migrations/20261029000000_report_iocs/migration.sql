-- CreateEnum
CREATE TYPE "IocKind" AS ENUM ('IPV4', 'DOMAIN', 'EMAIL', 'MD5', 'SHA1', 'SHA256');

-- CreateTable
CREATE TABLE "ReportIoc" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "kind" "IocKind" NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ReportIoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportIoc_kind_value_idx" ON "ReportIoc"("kind", "value");

-- CreateIndex
CREATE INDEX "ReportIoc_entryId_idx" ON "ReportIoc"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportIoc_reportId_kind_value_key" ON "ReportIoc"("reportId", "kind", "value");

-- AddForeignKey
ALTER TABLE "ReportIoc" ADD CONSTRAINT "ReportIoc_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportIoc" ADD CONSTRAINT "ReportIoc_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

