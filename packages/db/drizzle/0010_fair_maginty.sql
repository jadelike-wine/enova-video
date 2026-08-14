CREATE TABLE IF NOT EXISTS "user_agreement_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"revision" varchar(64) NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" varchar(64),
	"user_agent" varchar(512)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_agreement_acceptances" ADD CONSTRAINT "user_agreement_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_agreement_acceptances_user_id_idx" ON "user_agreement_acceptances" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_agreement_acceptances_user_revision_unique" ON "user_agreement_acceptances" USING btree ("user_id","revision");