-- CreateEnum
CREATE TYPE "CaptureStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "EntryEventType" ADD VALUE 'PAGE_CAPTURED';

-- CreateTable
CREATE TABLE "PageCapture" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" "CaptureStatus" NOT NULL DEFAULT 'PENDING',
    "url" TEXT NOT NULL,
    "finalUrl" TEXT,
    "title" TEXT,
    "httpStatus" INTEGER,
    "redirects" JSONB,
    "certificate" JSONB,
    "blocked" JSONB,
    "screenshotKey" TEXT,
    "htmlKey" TEXT,
    "htmlTruncated" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PageCapture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageCapture_entryId_createdAt_idx" ON "PageCapture"("entryId", "createdAt");

-- AddForeignKey
ALTER TABLE "PageCapture" ADD CONSTRAINT "PageCapture_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageCapture" ADD CONSTRAINT "PageCapture_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

