-- CreateEnum
CREATE TYPE "YaraRetroStatus" AS ENUM ('RUNNING', 'DONE', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "YaraRetroscan" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleName" TEXT NOT NULL,
    "status" "YaraRetroStatus" NOT NULL DEFAULT 'RUNNING',
    "total" INTEGER NOT NULL,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "YaraRetroscan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YaraRetroscanHit" (
    "retroscanId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "identifiers" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YaraRetroscanHit_pkey" PRIMARY KEY ("retroscanId","entryId")
);

-- CreateIndex
CREATE INDEX "YaraRetroscan_startedAt_idx" ON "YaraRetroscan"("startedAt");

-- AddForeignKey
ALTER TABLE "YaraRetroscan" ADD CONSTRAINT "YaraRetroscan_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "YaraRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YaraRetroscan" ADD CONSTRAINT "YaraRetroscan_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YaraRetroscanHit" ADD CONSTRAINT "YaraRetroscanHit_retroscanId_fkey" FOREIGN KEY ("retroscanId") REFERENCES "YaraRetroscan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YaraRetroscanHit" ADD CONSTRAINT "YaraRetroscanHit_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

