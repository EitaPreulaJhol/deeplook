-- CreateEnum
CREATE TYPE "AuthSource" AS ENUM ('LOCAL', 'LDAP');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authSource" "AuthSource" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "ldapDn" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_ldapDn_key" ON "User"("ldapDn");

