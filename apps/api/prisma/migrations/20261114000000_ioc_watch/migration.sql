-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'IOC_SEEN';

-- CreateTable
CREATE TABLE "IocWatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "IocKind" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IocWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IocWatch_kind_value_idx" ON "IocWatch"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "IocWatch_userId_kind_value_key" ON "IocWatch"("userId", "kind", "value");

-- AddForeignKey
ALTER TABLE "IocWatch" ADD CONSTRAINT "IocWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

