-- AlterTable
ALTER TABLE "ImportSettings" ADD COLUMN "includeOversized" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ImportSettings" ADD COLUMN "includeTokens" BOOLEAN NOT NULL DEFAULT false;
