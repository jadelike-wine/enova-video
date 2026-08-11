DROP INDEX IF EXISTS "assets_generation_job_id_idx";--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "provider_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "poll_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_generation_job_id_unique" ON "assets" USING btree ("generation_job_id");