-- Add skipped counter to ImportJob for tracking cards skipped during import.
-- Mirrors inventory-ops migration 20260219_add_skipped_to_import_job.

-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN "skipped" INTEGER NOT NULL DEFAULT 0;
