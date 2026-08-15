ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "default_value" text DEFAULT '' NOT NULL;

UPDATE "settings"
SET "default_value" = CASE "key"
  WHEN 'billing.welcomeCredits' THEN '100'
  WHEN 'storage.provider' THEN 'aws_s3'
  WHEN 'storage.awsRegion' THEN 'ap-southeast-1'
  WHEN 'storage.awsS3Prefix' THEN 'agnes-ai'
  WHEN 'storage.qiniuRegion' THEN 'z0'
  WHEN 'log.level' THEN 'info'
  WHEN 'log.format' THEN 'text'
  WHEN 'log.prompts' THEN 'false'
  WHEN 'log.accessLog' THEN 'true'
  WHEN 'email.smtpPort' THEN '587'
  WHEN 'email.smtpSecure' THEN 'false'
  WHEN 'email.smtpFromName' THEN 'EnovaMotion'
  WHEN 'email.passwordResetUrl' THEN 'http://localhost:3000/auth/reset-password'
  WHEN 'email.emailVerifyUrl' THEN 'http://localhost:3000/auth/verify-email'
  WHEN 'security.rateLimitEnabled' THEN 'true'
  WHEN 'security.rateLimitPrefix' THEN 'enova:rl'
  WHEN 'general.supportEmail' THEN 'support@example.com'
  ELSE "default_value"
END
WHERE "default_value" = '';
