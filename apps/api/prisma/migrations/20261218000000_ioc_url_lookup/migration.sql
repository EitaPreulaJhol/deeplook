-- CreateTable
CREATE TABLE "IocUrlLookup" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IocUrlLookup_pkey" PRIMARY KEY ("userId","key")
);

-- AddForeignKey
ALTER TABLE "IocUrlLookup" ADD CONSTRAINT "IocUrlLookup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
