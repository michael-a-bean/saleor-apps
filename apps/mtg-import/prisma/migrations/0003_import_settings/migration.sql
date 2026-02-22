-- Per-installation import configuration.
-- Uses IF NOT EXISTS / EXCEPTION handling so this is safe to run multiple times.

CREATE TABLE IF NOT EXISTS "ImportSettings" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "channelSlugs" TEXT[] DEFAULT ARRAY['webstore','singles-builder']::TEXT[],
    "productTypeSlug" TEXT NOT NULL DEFAULT 'mtg-card',
    "categorySlug" TEXT NOT NULL DEFAULT 'mtg-singles',
    "warehouseSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conditionNm" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "conditionLp" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "conditionMp" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "conditionHp" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "conditionDmg" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "defaultPrice" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "costPriceRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "visibleInListings" BOOLEAN NOT NULL DEFAULT true,
    "isAvailableForPurchase" BOOLEAN NOT NULL DEFAULT true,
    "trackInventory" BOOLEAN NOT NULL DEFAULT false,
    "importableSetTypes" TEXT[] DEFAULT ARRAY['core','expansion','masters','draft_innovation','commander','starter','funny']::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportSettings_pkey" PRIMARY KEY ("id")
);

-- Unique index on installationId
DO $$ BEGIN
  CREATE UNIQUE INDEX "ImportSettings_installationId_key" ON "ImportSettings"("installationId");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- Foreign key to AppInstallation
DO $$ BEGIN
  ALTER TABLE "ImportSettings" ADD CONSTRAINT "ImportSettings_installationId_fkey"
    FOREIGN KEY ("installationId") REFERENCES "AppInstallation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
