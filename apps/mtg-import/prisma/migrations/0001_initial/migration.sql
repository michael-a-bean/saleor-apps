-- Baseline migration for mtg-import standalone schema.
-- These tables already exist in the shared database (created by inventory-ops).
-- All statements use IF NOT EXISTS / OR REPLACE so this migration is safe to
-- run against a database where the objects already exist.
--
-- NOTE: AppInstallation is NOT created here — it is owned by inventory-ops.
-- The enums and FK references assume AppInstallation already exists.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ImportJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ImportJobType" AS ENUM ('SET', 'BULK', 'BACKFILL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ImportJob" (
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
CREATE TABLE IF NOT EXISTS "ImportedProduct" (
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
CREATE TABLE IF NOT EXISTS "SetAudit" (
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
CREATE INDEX IF NOT EXISTS "ImportJob_installationId_idx" ON "ImportJob"("installationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ImportJob_status_idx" ON "ImportJob"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ImportJob_priority_status_idx" ON "ImportJob"("priority", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ImportedProduct_importJobId_idx" ON "ImportedProduct"("importJobId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ImportedProduct_setCode_idx" ON "ImportedProduct"("setCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ImportedProduct_saleorProductId_idx" ON "ImportedProduct"("saleorProductId");

-- CreateIndex (unique indexes need DO block for IF NOT EXISTS)
DO $$ BEGIN
  CREATE UNIQUE INDEX "ImportedProduct_scryfallId_setCode_key" ON "ImportedProduct"("scryfallId", "setCode");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SetAudit_installationId_idx" ON "SetAudit"("installationId");

-- CreateIndex
DO $$ BEGIN
  CREATE UNIQUE INDEX "SetAudit_installationId_setCode_key" ON "SetAudit"("installationId", "setCode");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- AddForeignKey (idempotent: check if constraint exists first)
DO $$ BEGIN
  ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "AppInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ImportedProduct" ADD CONSTRAINT "ImportedProduct_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "SetAudit" ADD CONSTRAINT "SetAudit_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "AppInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
