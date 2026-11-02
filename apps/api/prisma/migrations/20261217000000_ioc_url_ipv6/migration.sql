-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IocKind" ADD VALUE 'IPV6';
ALTER TYPE "IocKind" ADD VALUE 'URL';

-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "urlKey" TEXT;

-- CreateTable
CREATE TABLE "IocUrl" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IocUrl_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Entry_urlKey_idx" ON "Entry"("urlKey");

