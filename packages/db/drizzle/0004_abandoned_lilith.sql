CREATE TABLE IF NOT EXISTS "settings" (
	"key" varchar(120) PRIMARY KEY NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"value_type" varchar(20) DEFAULT 'string' NOT NULL,
	"group" varchar(80) DEFAULT 'general' NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settings_group_idx" ON "settings" USING btree ("group");