-- 0009: Add CREDITS_PENDING status + workspace_id + credits_to_revoke + external_refunded_at
-- SAFE for databases already at 0008 (may have existing manual_refund_records rows).
--
-- Key safety measures:
-- 1. workspace_id: added as nullable → backfilled via JOIN → explicit NULL check → then set NOT NULL + FK.
--    If any row still has NULL workspace_id after backfill, migration FAILS with a diagnostic error.
-- 2. channel_refund_no / refund_channel: explicit NULL check before setting NOT NULL.
--    If any row has NULL, migration FAILS with a diagnostic error — no silent skip.
-- 3. Duplicate channel_refund_no check before creating unique index.
--    If duplicates exist, migration FAILS with a diagnostic error.
-- 4. Regular (non-partial) unique index on channel_refund_no — consistent with Drizzle schema.
--    This is safe because channel_refund_no is set NOT NULL before the index is created.
-- 5. credits_to_revoke: safe default 0.
-- 6. external_refunded_at: nullable (old records don't have it).

ALTER TYPE "public"."manual_refund_status" ADD VALUE IF NOT EXISTS 'CREDITS_PENDING' BEFORE 'REJECTED';--> statement-breakpoint

-- Add workspace_id as nullable first (safe for existing rows).
ALTER TABLE "manual_refund_records" ADD COLUMN IF NOT EXISTS "workspace_id" uuid;--> statement-breakpoint

-- Backfill workspace_id from orders via JOIN.
UPDATE "manual_refund_records"
SET "workspace_id" = o.workspace_id
FROM "orders" o
WHERE "manual_refund_records"."order_id" = o."id"
  AND "manual_refund_records"."workspace_id" IS NULL;--> statement-breakpoint

-- Explicit NULL check: if any row still has NULL workspace_id, FAIL with diagnostic.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "manual_refund_records" WHERE "workspace_id" IS NULL) THEN
    RAISE EXCEPTION 'Migration 0009 aborted: % row(s) in manual_refund_records have NULL workspace_id after backfill. '
      'This indicates orphaned records without a matching order. '
      'Please backfill or clean up these rows before upgrading.',
      (SELECT count(*) FROM "manual_refund_records" WHERE "workspace_id" IS NULL);
  END IF;
END $$;--> statement-breakpoint

-- Set workspace_id NOT NULL (safe: we verified no NULLs above).
ALTER TABLE "manual_refund_records" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint

-- Add FK for workspace_id.
DO $$ BEGIN
 ALTER TABLE "manual_refund_records" ADD CONSTRAINT "manual_refund_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
 WHEN invalid_foreign_key THEN null;
END $$;--> statement-breakpoint

-- Add credits_to_revoke (safe default 0).
ALTER TABLE "manual_refund_records" ADD COLUMN IF NOT EXISTS "credits_to_revoke" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Add external_refunded_at (nullable — old records don't have it).
ALTER TABLE "manual_refund_records" ADD COLUMN IF NOT EXISTS "external_refunded_at" timestamp with time zone;--> statement-breakpoint

-- Explicit NULL check for channel_refund_no: FAIL if any NULLs exist.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "manual_refund_records" WHERE "channel_refund_no" IS NULL) THEN
    RAISE EXCEPTION 'Migration 0009 aborted: % row(s) in manual_refund_records have NULL channel_refund_no. '
      'All refund records must have a channel refund number. '
      'Please backfill or clean up these rows before upgrading.',
      (SELECT count(*) FROM "manual_refund_records" WHERE "channel_refund_no" IS NULL);
  END IF;
END $$;--> statement-breakpoint

-- Set channel_refund_no NOT NULL (safe: we verified no NULLs above).
ALTER TABLE "manual_refund_records" ALTER COLUMN "channel_refund_no" SET NOT NULL;--> statement-breakpoint

-- Explicit NULL check for refund_channel: FAIL if any NULLs exist.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "manual_refund_records" WHERE "refund_channel" IS NULL) THEN
    RAISE EXCEPTION 'Migration 0009 aborted: % row(s) in manual_refund_records have NULL refund_channel. '
      'All refund records must have a refund channel. '
      'Please backfill or clean up these rows before upgrading.',
      (SELECT count(*) FROM "manual_refund_records" WHERE "refund_channel" IS NULL);
  END IF;
END $$;--> statement-breakpoint

-- Set refund_channel NOT NULL (safe: we verified no NULLs above).
ALTER TABLE "manual_refund_records" ALTER COLUMN "refund_channel" SET NOT NULL;--> statement-breakpoint

-- Explicit duplicate check for channel_refund_no: FAIL if duplicates exist.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT "channel_refund_no" FROM "manual_refund_records"
      GROUP BY "channel_refund_no" HAVING count(*) > 1
    ) dups
  ) THEN
    RAISE EXCEPTION 'Migration 0009 aborted: duplicate channel_refund_no values found in manual_refund_records. '
      'Duplicate values: %',
      (SELECT string_agg(DISTINCT "channel_refund_no", ', ')
       FROM "manual_refund_records"
       WHERE "channel_refund_no" IN (
         SELECT "channel_refund_no" FROM "manual_refund_records"
         GROUP BY "channel_refund_no" HAVING count(*) > 1
       ));
  END IF;
END $$;--> statement-breakpoint

-- Create regular unique index on channel_refund_no (non-partial, consistent with Drizzle schema).
-- Safe: channel_refund_no is NOT NULL and duplicates have been verified absent.
CREATE UNIQUE INDEX IF NOT EXISTS "manual_refund_records_channel_refund_no_unique"
ON "manual_refund_records" USING btree ("channel_refund_no");
