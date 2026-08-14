CREATE TYPE "public"."manual_refund_status" AS ENUM('PENDING_REVIEW', 'APPROVED', 'COMPLETED', 'REJECTED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "manual_refund_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "manual_refund_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"reason" varchar(500) NOT NULL,
	"refund_amount_cents" integer NOT NULL,
	"is_full_refund" boolean NOT NULL,
	"channel_refund_no" varchar(255),
	"refund_channel" varchar(50),
	"credits_revoked" bigint DEFAULT 0 NOT NULL,
	"credits_fully_revoked" boolean DEFAULT true NOT NULL,
	"operator_id" uuid NOT NULL,
	"review_note" varchar(1000),
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "manual_refund_records" ADD CONSTRAINT "manual_refund_records_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manual_refund_records_order_id_idx" ON "manual_refund_records" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manual_refund_records_status_idx" ON "manual_refund_records" USING btree ("status");