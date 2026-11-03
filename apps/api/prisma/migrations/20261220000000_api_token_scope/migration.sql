-- CreateEnum
CREATE TYPE "ApiTokenScope" AS ENUM ('SAMPLES', 'STATUS');

-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN     "scope" "ApiTokenScope" NOT NULL DEFAULT 'SAMPLES';
