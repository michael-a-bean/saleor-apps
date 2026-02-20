/**
 * Local type definitions for the MTG Import app's Prisma models.
 *
 * These exist because the generated Prisma client is from an older schema version.
 * Once `prisma generate` is re-run (requires fixing node_modules ownership),
 * these can be removed and the Prisma-inferred types used directly.
 */

export interface ImportJob {
  id: string;
  installationId: string;
  type: "SET" | "BULK" | "BACKFILL";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  priority: number;
  setCode: string | null;
  cardsProcessed: number;
  cardsTotal: number;
  variantsCreated: number;
  errors: number;
  skipped: number;
  lastCheckpoint: string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  errorMessage: string | null;
  errorLog: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface ImportJobWithProducts extends ImportJob {
  importedProducts: ImportedProduct[];
  _count?: { importedProducts: number };
}

export interface ImportedProduct {
  id: string;
  importJobId: string;
  scryfallId: string;
  scryfallUri: string | null;
  cardName: string;
  setCode: string;
  collectorNumber: string;
  rarity: string;
  saleorProductId: string;
  variantCount: number;
  success: boolean;
  errorMessage: string | null;
  createdAt: Date | string;
}

export interface SetAudit {
  id: string;
  installationId: string;
  setCode: string;
  setName: string;
  totalCards: number;
  importedCards: number;
  lastImportedAt: Date | string;
  releasedAt: Date | string | null;
  setType: string | null;
  iconSvgUri: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}
