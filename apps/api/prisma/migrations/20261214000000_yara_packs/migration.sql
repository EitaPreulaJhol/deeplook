-- AlterTable
ALTER TABLE "YaraRule" ADD COLUMN     "pack" TEXT;

-- CreateIndex
CREATE INDEX "YaraRule_pack_idx" ON "YaraRule"("pack");

