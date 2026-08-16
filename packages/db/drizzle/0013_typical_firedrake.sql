CREATE TABLE IF NOT EXISTS "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" varchar(120) NOT NULL,
	"locale" varchar(10) NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "name" varchar(200);--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "remark" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_event_locale_idx" ON "email_templates" USING btree ("event","locale");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_templates_event_idx" ON "email_templates" USING btree ("event");