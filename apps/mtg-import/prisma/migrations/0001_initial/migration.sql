-- Initial migration for mtg-import app

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('BULK_IMPORT', 'NEW_SET', 'ATTRIBUTE_ENRICHMENT', 'CHANNEL_SYNC', 'RECONCILIATION', 'AUDIT', 'REMEDIATION');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttributeStatus" AS ENUM ('BASE', 'ENRICHED');

-- CreateTable
CREATE TABLE "AppInstallation" (
    "id" TEXT NOT NULL,
    "saleorApiUrl" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "jobType" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB,
    "totalItems" INTEGER,
    "processedItems" INTEGER NOT NULL DEFAULT 0,
    "checkpoint" JSONB,
    "error" TEXT,
    "logs" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportedProduct" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "scryfallId" TEXT NOT NULL,
    "oracleId" TEXT,
    "cardName" TEXT NOT NULL,
    "setCode" TEXT NOT NULL,
    "collectorNumber" TEXT NOT NULL,
    "saleorProductId" TEXT NOT NULL,
    "attributeStatus" "AttributeStatus" NOT NULL DEFAULT 'BASE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "importJobId" TEXT,

    CONSTRAINT "ImportedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetAudit" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "setCode" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "scryfallCardCount" INTEGER NOT NULL,
    "saleorProductCount" INTEGER NOT NULL,
    "saleorVariantCount" INTEGER NOT NULL,
    "pricedCount" INTEGER NOT NULL DEFAULT 0,
    "indexedCount" INTEGER NOT NULL DEFAULT 0,
    "missingCards" JSONB NOT NULL DEFAULT '[]',
    "missingVariants" JSONB NOT NULL DEFAULT '[]',
    "pricingGaps" JSONB NOT NULL DEFAULT '[]',
    "sellableTimestamp" TIMESTAMP(3),
    "auditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppInstallation_saleorApiUrl_idx" ON "AppInstallation"("saleorApiUrl");

-- CreateIndex
CREATE UNIQUE INDEX "AppInstallation_saleorApiUrl_appId_key" ON "AppInstallation"("saleorApiUrl", "appId");

-- CreateIndex
CREATE INDEX "ImportJob_installationId_idx" ON "ImportJob"("installationId");

-- CreateIndex
CREATE INDEX "ImportJob_status_priority_idx" ON "ImportJob"("status", "priority");

-- CreateIndex
CREATE INDEX "ImportJob_createdAt_idx" ON "ImportJob"("createdAt");

-- CreateIndex
CREATE INDEX "ImportedProduct_installationId_idx" ON "ImportedProduct"("installationId");

-- CreateIndex
CREATE INDEX "ImportedProduct_scryfallId_idx" ON "ImportedProduct"("scryfallId");

-- CreateIndex
CREATE INDEX "ImportedProduct_setCode_idx" ON "ImportedProduct"("setCode");

-- CreateIndex
CREATE INDEX "ImportedProduct_saleorProductId_idx" ON "ImportedProduct"("saleorProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedProduct_installationId_scryfallId_key" ON "ImportedProduct"("installationId", "scryfallId");

-- CreateIndex
CREATE INDEX "SetAudit_installationId_idx" ON "SetAudit"("installationId");

-- CreateIndex
CREATE INDEX "SetAudit_auditedAt_idx" ON "SetAudit"("auditedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SetAudit_installationId_setCode_key" ON "SetAudit"("installationId", "setCode");

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "AppInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedProduct" ADD CONSTRAINT "ImportedProduct_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "AppInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedProduct" ADD CONSTRAINT "ImportedProduct_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetAudit" ADD CONSTRAINT "SetAudit_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "AppInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
