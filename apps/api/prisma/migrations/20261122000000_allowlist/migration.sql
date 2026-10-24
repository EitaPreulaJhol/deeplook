-- AlterEnum


ALTER TYPE "AuditAction" ADD VALUE 'ALLOWLIST_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'ALLOWLIST_REMOVED';

-- CreateTable
CREATE TABLE "AllowedIndicator" (
    "id" TEXT NOT NULL,
    "kind" "IocKind" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllowedIndicator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AllowedIndicator_kind_value_key" ON "AllowedIndicator"("kind", "value");

-- AddForeignKey
ALTER TABLE "AllowedIndicator" ADD CONSTRAINT "AllowedIndicator_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

