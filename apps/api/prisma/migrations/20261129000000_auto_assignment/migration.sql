-- AlterTable
ALTER TABLE "User" ADD COLUMN     "away" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AssignmentGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentGroupMember" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastAssignedAt" TIMESTAMP(3),

    CONSTRAINT "AssignmentGroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateTable
CREATE TABLE "AssignmentRule" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "groupId" TEXT NOT NULL,
    "entryType" "EntryType",
    "tag" TEXT,
    "priority" "Priority",
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentGroup_name_key" ON "AssignmentGroup"("name");

-- CreateIndex
CREATE INDEX "AssignmentRule_position_idx" ON "AssignmentRule"("position");

-- AddForeignKey
ALTER TABLE "AssignmentGroupMember" ADD CONSTRAINT "AssignmentGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AssignmentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentGroupMember" ADD CONSTRAINT "AssignmentGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentRule" ADD CONSTRAINT "AssignmentRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AssignmentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

