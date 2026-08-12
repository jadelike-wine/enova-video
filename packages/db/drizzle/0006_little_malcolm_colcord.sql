CREATE TYPE "public"."cost_type" AS ENUM('VIDEO_GENERATION', 'IMAGE_GENERATION', 'LLM', 'TTS', 'STORAGE', 'EGRESS', 'GPU', 'THIRD_PARTY');--> statement-breakpoint
CREATE TYPE "public"."revenue_type" AS ENUM('RECHARGE', 'PLAN', 'CREDIT_PACK', 'GENERATION');--> statement-breakpoint
CREATE TYPE "public"."step_up_method" AS ENUM('PASSWORD', 'TOTP', 'MFA', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."trial_status" AS ENUM('NONE', 'ACTIVE', 'EXPIRED', 'CONVERTED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cost_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" varchar(255) NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"generation_job_id" uuid,
	"generation_attempt_id" uuid,
	"asset_id" uuid,
	"cost_type" "cost_type" NOT NULL,
	"provider" varchar(50) NOT NULL,
	"model" varchar(100) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit" varchar(30),
	"unit_cost_microusd" integer DEFAULT 0 NOT NULL,
	"total_cost_microusd" integer DEFAULT 0 NOT NULL,
	"status" "cost_status" DEFAULT 'ESTIMATED' NOT NULL,
	"external_billing_id" varchar(255),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata_json" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"discount_amount_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"type" varchar(20) NOT NULL,
	"value" integer NOT NULL,
	"currency" varchar(3),
	"max_redemptions" integer DEFAULT 0 NOT NULL,
	"per_user_limit" integer DEFAULT 1 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(120) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "revenue_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" varchar(255) NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid,
	"generation_job_id" uuid,
	"wallet_ledger_id" uuid,
	"revenue_type" "revenue_type" NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"gross_amount_cents" integer DEFAULT 0 NOT NULL,
	"refund_amount_cents" integer DEFAULT 0 NOT NULL,
	"fee_amount_cents" integer DEFAULT 0 NOT NULL,
	"recognized_amount_cents" integer DEFAULT 0 NOT NULL,
	"recognized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata_json" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sensitive_action_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"permission" varchar(120) NOT NULL,
	"target" varchar(120),
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"request_id" varchar(120),
	"step_up_method" "step_up_method" DEFAULT 'NONE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(120) NOT NULL,
	"version" integer NOT NULL,
	"before" text,
	"after" text,
	"reason" text,
	"updated_by" uuid,
	"request_id" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_jobs" DROP CONSTRAINT "generation_jobs_price_quote_id_price_quotes_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_code" varchar(80);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_snapshot_json" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "original_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_amount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "final_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "allowed_generation_types" jsonb;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "allowed_resolutions" jsonb;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "daily_generation_limit" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "monthly_generation_limit" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "daily_credit_limit" bigint;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "monthly_credit_limit" bigint;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "rpm" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ip" varchar(64);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_agent" varchar(512);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_name" varchar(255);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trial_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trial_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trial_status" "trial_status" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_generation_attempt_id_generation_attempts_id_fk" FOREIGN KEY ("generation_attempt_id") REFERENCES "public"."generation_attempts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "revenue_events" ADD CONSTRAINT "revenue_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "revenue_events" ADD CONSTRAINT "revenue_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "revenue_events" ADD CONSTRAINT "revenue_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "revenue_events" ADD CONSTRAINT "revenue_events_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "revenue_events" ADD CONSTRAINT "revenue_events_wallet_ledger_id_wallet_ledger_id_fk" FOREIGN KEY ("wallet_ledger_id") REFERENCES "public"."wallet_ledger"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sensitive_action_logs" ADD CONSTRAINT "sensitive_action_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settings_history" ADD CONSTRAINT "settings_history_key_settings_key_fk" FOREIGN KEY ("key") REFERENCES "public"."settings"("key") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settings_history" ADD CONSTRAINT "settings_history_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cost_events_event_key_unique" ON "cost_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_events_workspace_id_idx" ON "cost_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_events_generation_job_id_idx" ON "cost_events" USING btree ("generation_job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_events_occurred_at_idx" ON "cost_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "coupon_redemptions_order_id_unique" ON "coupon_redemptions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coupon_redemptions_coupon_id_idx" ON "coupon_redemptions" USING btree ("coupon_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coupon_redemptions_user_id_idx" ON "coupon_redemptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "coupons_code_unique" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_idx" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_code_unique" ON "permissions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "revenue_events_event_key_unique" ON "revenue_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revenue_events_workspace_id_idx" ON "revenue_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revenue_events_order_id_idx" ON "revenue_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revenue_events_recognized_at_idx" ON "revenue_events" USING btree ("recognized_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_role_perm_unique" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_permissions_permission_id_idx" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roles_code_unique" ON "roles" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sensitive_action_logs_actor_user_id_idx" ON "sensitive_action_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sensitive_action_logs_created_at_idx" ON "sensitive_action_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settings_history_key_idx" ON "settings_history" USING btree ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settings_history_created_at_idx" ON "settings_history" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_role_assignments_user_role_unique" ON "user_role_assignments" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_role_assignments_user_id_idx" ON "user_role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "generation_dispatch_outbox_job_event_unique" ON "generation_dispatch_outbox" USING btree ("generation_job_id","event_type");