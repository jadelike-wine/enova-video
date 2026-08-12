CREATE TYPE "public"."attempt_status" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."cost_status" AS ENUM('ESTIMATED', 'REPORTED', 'RECONCILED');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('RECHARGE', 'PLAN', 'CREDIT_PACK');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('PENDING', 'DISPATCHED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."pricing_version_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('RESERVED', 'PARTIALLY_CAPTURED', 'CAPTURED', 'RELEASED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"generation_job_id" uuid NOT NULL,
	"reserved_credits" bigint NOT NULL,
	"captured_credits" bigint DEFAULT 0 NOT NULL,
	"released_credits" bigint DEFAULT 0 NOT NULL,
	"status" "reservation_status" DEFAULT 'RESERVED' NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "generation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_job_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"provider" varchar(50) NOT NULL,
	"model" varchar(100) NOT NULL,
	"credential_id" uuid,
	"provider_job_id" varchar(255),
	"status" "attempt_status" DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"error_code" varchar(100),
	"error_message" text,
	"estimated_cost_microusd" integer DEFAULT 0 NOT NULL,
	"reported_cost_microusd" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "generation_dispatch_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_job_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"payload_json" jsonb,
	"status" "outbox_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_job_id" uuid,
	"pricing_version_id" uuid NOT NULL,
	"input_snapshot" jsonb,
	"estimated_credits" bigint NOT NULL,
	"estimated_revenue_cents" integer DEFAULT 0 NOT NULL,
	"estimated_cost_microusd" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pricing_rule_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"generation_type" "generation_type" NOT NULL,
	"provider" varchar(50) NOT NULL,
	"model" varchar(100) NOT NULL,
	"dimensions_json" jsonb,
	"credits" bigint NOT NULL,
	"pricing_json" jsonb,
	"status" "pricing_version_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_fulfillments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subscription_id" uuid,
	"status" "fulfillment_status" DEFAULT 'PENDING' NOT NULL,
	"credits_granted" bigint DEFAULT 0 NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX IF EXISTS "payment_transactions_provider_ref_idx";--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD COLUMN "request_id" varchar(120);--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "estimated_cost_microusd" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "reported_cost_microusd" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "final_cost_microusd" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "cost_status" "cost_status" DEFAULT 'ESTIMATED' NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "pricing_version_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "price_quote_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "order_type" "order_type" DEFAULT 'RECHARGE' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "currency" varchar(3) DEFAULT 'CNY' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "snapshot_json" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment_status" "fulfillment_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD COLUMN "refund_amount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD COLUMN "refund_status" "payment_status";--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD COLUMN "refund_ref" varchar(255);--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "price_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "currency" varchar(3) DEFAULT 'CNY' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "period_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "one_time" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_concurrent_generations" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_resolution" integer DEFAULT 720 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_duration_seconds" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "storage_retention_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "watermark" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "commercial_use" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "allowed_models" jsonb;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "entitlements_json" jsonb;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "estimated_cost_microusd" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "reported_cost_microusd" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "final_cost_microusd" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "cost_status" "cost_status" DEFAULT 'ESTIMATED' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_dispatch_outbox" ADD CONSTRAINT "generation_dispatch_outbox_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_pricing_version_id_pricing_versions_id_fk" FOREIGN KEY ("pricing_version_id") REFERENCES "public"."pricing_versions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_pricing_rule_id_pricing_rules_id_fk" FOREIGN KEY ("pricing_rule_id") REFERENCES "public"."pricing_rules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_fulfillments" ADD CONSTRAINT "subscription_fulfillments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_fulfillments" ADD CONSTRAINT "subscription_fulfillments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_fulfillments" ADD CONSTRAINT "subscription_fulfillments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_reservations_generation_job_id_unique" ON "credit_reservations" USING btree ("generation_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_reservations_idempotency_key_unique" ON "credit_reservations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_reservations_wallet_id_idx" ON "credit_reservations" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_reservations_status_idx" ON "credit_reservations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "generation_attempts_job_attempt_unique" ON "generation_attempts" USING btree ("generation_job_id","attempt_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_attempts_generation_job_id_idx" ON "generation_attempts" USING btree ("generation_job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_attempts_status_idx" ON "generation_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_dispatch_outbox_status_available_at_idx" ON "generation_dispatch_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_dispatch_outbox_generation_job_id_idx" ON "generation_dispatch_outbox" USING btree ("generation_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "generation_dispatch_outbox_job_event_unique" ON "generation_dispatch_outbox" USING btree ("generation_job_id","event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_quotes_generation_job_id_idx" ON "price_quotes" USING btree ("generation_job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_quotes_pricing_version_id_idx" ON "price_quotes" USING btree ("pricing_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricing_versions_rule_version_idx" ON "pricing_versions" USING btree ("pricing_rule_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricing_versions_type_provider_model_idx" ON "pricing_versions" USING btree ("generation_type","provider","model");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pricing_versions_rule_version_unique" ON "pricing_versions" USING btree ("pricing_rule_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_fulfillments_idempotency_key_unique" ON "subscription_fulfillments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_fulfillments_order_id_idx" ON "subscription_fulfillments" USING btree ("order_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_pricing_version_id_pricing_versions_id_fk" FOREIGN KEY ("pricing_version_id") REFERENCES "public"."pricing_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_price_quote_id_price_quotes_id_fk" FOREIGN KEY ("price_quote_id") REFERENCES "public"."price_quotes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_logs_resource_type_idx" ON "admin_audit_logs" USING btree ("resource_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_logs_created_at_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_jobs_pricing_version_id_idx" ON "generation_jobs" USING btree ("pricing_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_provider_ref_unique" ON "payment_transactions" USING btree ("provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "usage_events_generation_job_id_unique" ON "usage_events" USING btree ("generation_job_id");
--> statement-breakpoint
-- CHECK constraints for financial invariants (DB-level protection)
-- NOTE: PostgreSQL does NOT support "ADD CONSTRAINT IF NOT EXISTS" for CHECK
-- constraints. Use DO/EXCEPTION WHEN duplicate_object for idempotency instead
-- (same pattern as the FK constraints above).
DO $$ BEGIN
 ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_reserved_nonneg" CHECK ("reserved_credits" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_captured_nonneg" CHECK ("captured_credits" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_released_nonneg" CHECK ("released_credits" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_invariant" CHECK ("captured_credits" + "released_credits" <= "reserved_credits");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_nonneg" CHECK ("balance" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallets" ADD CONSTRAINT "wallets_reserved_nonneg" CHECK ("reserved_balance" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_credits_nonneg" CHECK ("credits" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_credits_nonneg" CHECK ("estimated_credits" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_amount_nonneg" CHECK ("amount_cents" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_credits_nonneg" CHECK ("credits" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_cost_nonneg" CHECK ("estimated_cost_microusd" >= 0 AND "reported_cost_microusd" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_credits_nonneg" CHECK ("estimated_credits" >= 0 AND "reserved_credits" >= 0 AND "actual_credits" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_cost_nonneg" CHECK ("estimated_cost_microusd" >= 0 AND "reported_cost_microusd" >= 0 AND "final_cost_microusd" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;