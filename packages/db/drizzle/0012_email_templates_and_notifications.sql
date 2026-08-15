-- Email Templates table
CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event" varchar(120) NOT NULL,
  "locale" varchar(10) NOT NULL,
  "subject" text NOT NULL,
  "html" text NOT NULL,
  "is_custom" boolean DEFAULT false NOT NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "email_templates_event_locale_idx" UNIQUE ("event","locale")
);
CREATE INDEX IF NOT EXISTS "email_templates_event_idx" ON "email_templates" ("event");

-- Insert email notification settings defaults (idempotent)
INSERT INTO "settings" ("key", "value", "value_type", "default_value", "group", "is_secret", "version")
VALUES
  ('email.subscriptionExpiryNotifyEnabled', 'false', 'boolean', 'false', 'email', false, 1),
  ('email.balanceLowNotifyEnabled', 'false', 'boolean', 'false', 'email', false, 1),
  ('email.balanceLowNotifyThreshold', '0', 'number', '0', 'email', false, 1),
  ('email.balanceLowNotifyRechargeUrl', '', 'string', '', 'email', false, 1),
  ('email.accountQuotaNotifyEnabled', 'false', 'boolean', 'false', 'email', false, 1),
  ('email.accountQuotaNotifyEmails', '[]', 'string', '[]', 'email', false, 1)
ON CONFLICT ("key") DO NOTHING;
