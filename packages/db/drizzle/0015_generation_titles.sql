ALTER TABLE "generation_jobs" ADD COLUMN "title" varchar(120) DEFAULT '未命名对话' NOT NULL;
ALTER TABLE "generation_jobs" ADD COLUMN "title_generation_status" varchar(20) DEFAULT 'PENDING' NOT NULL;

-- Historical jobs predate AI title generation and must retain the explicit fallback.
UPDATE "generation_jobs"
SET "title_generation_status" = 'SKIPPED'
WHERE "title_generation_status" = 'PENDING';
