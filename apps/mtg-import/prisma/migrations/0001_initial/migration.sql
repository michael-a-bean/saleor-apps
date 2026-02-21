-- Baseline migration for mtg-import standalone schema.
-- These tables already exist in the shared database (created by inventory-ops).
-- This migration will be marked as applied via `prisma migrate resolve --applied`.
--
-- NOTE: AppInstallation is NOT created here — it is owned by inventory-ops.
-- The enums and FK references assume AppInstallation already exists.

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportJobType" AS ENUM ('SET', 'BULK', 'BACKFILL');

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "type" "ImportJobType" NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 2,
    "setCode" TEXT,
    "cardsProcessed" INTEGER NOT NULL DEFAULT 0,
    "cardsTotal" INTEGER NOT NULL DEFAULT 0,
    "variantsCreated" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "lastCheckpoint" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "errorLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportedProduct" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "scryfallId" TEXT NOT NULL,
    "scryfallUri" TEXT,
    "cardName" TEXT NOT NULL,
    "setCode" TEXT NOT NULL,
    "collectorNumber" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "saleorProductId" TEXT NOT NULL,
    "variantCount" INTEGER NOT NULL DEFAULT 15,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetAudit" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "setCode" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "totalCards" INTEGER NOT NULL,
    "importedCards" INTEGER NOT NULL,
    "lastImportedAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "setType" TEXT,
    "iconSvgUri" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportJob_installationId_idx" ON "ImportJob"("installationId");

-- CreateIndex
CREATE INDEX "ImportJob_status_idx" ON "ImportJob"("status");

-- CreateIndex
CREATE INDEX "ImportJob_priority_status_idx" ON "ImportJob"("priority", "status");

-- CreateIndex
CREATE INDEX "ImportedProduct_importJobId_idx" ON "ImportedProduct"("importJobId");

-- CreateIndex
CREATE INDEX "ImportedProduct_setCode_idx" ON "ImportedProduct"("setCode");

-- CreateIndex
CREATE INDEX "ImportedProduct_saleorProductId_idx" ON "ImportedProduct"("saleorProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedProduct_scryfallId_setCode_key" ON "ImportedProduct"("scryfallId", "setCode");

-- CreateIndex
CREATE INDEX "SetAudit_installationId_idx" ON "SetAudit"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "SetAudit_installationId_setCode_key" ON "SetAudit"("installationId", "setCode");

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "AppInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedProduct" ADD CONSTRAINT "ImportedProduct_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetAudit" ADD CONSTRAINT "SetAudit_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "AppInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
