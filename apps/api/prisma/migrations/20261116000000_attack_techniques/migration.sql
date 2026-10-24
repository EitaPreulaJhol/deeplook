-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "attackTechniques" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Report_attackTechniques_idx" ON "Report" USING GIN ("attackTechniques");

