-- Dynamic pricing: add calculation_snapshot column to price_quotes for audit trail.
ALTER TABLE "price_quotes" ADD COLUMN "calculation_snapshot" jsonb;
