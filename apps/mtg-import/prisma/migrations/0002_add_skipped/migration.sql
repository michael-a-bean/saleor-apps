-- Add skipped counter to ImportJob for tracking cards skipped during import.
-- Mirrors inventory-ops migration 20260219_add_skipped_to_import_job.
-- Uses IF NOT EXISTS so this is safe to run against a database where the column already exists.

DO $$ BEGIN
  ALTER TABLE "ImportJob" ADD COLUMN "skipped" INTEGER NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
