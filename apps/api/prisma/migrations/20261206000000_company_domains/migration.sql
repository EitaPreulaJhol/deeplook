-- CreateEnum
CREATE TYPE "LookalikeReason" AS ENUM ('TLD', 'HOMOGLYPH', 'TYPO', 'KEYWORD', 'SUBDOMAIN');

-- CreateTable
CREATE TABLE "CompanyDomain" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LookalikeHit" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "companyDomain" TEXT NOT NULL,
    "reason" "LookalikeReason" NOT NULL,
    "detail" TEXT,
    "sources" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LookalikeHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyDomain_domain_key" ON "CompanyDomain"("domain");

-- CreateIndex
CREATE INDEX "LookalikeHit_domain_idx" ON "LookalikeHit"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "LookalikeHit_entryId_domain_key" ON "LookalikeHit"("entryId", "domain");

-- AddForeignKey
ALTER TABLE "CompanyDomain" ADD CONSTRAINT "CompanyDomain_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookalikeHit" ADD CONSTRAINT "LookalikeHit_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

