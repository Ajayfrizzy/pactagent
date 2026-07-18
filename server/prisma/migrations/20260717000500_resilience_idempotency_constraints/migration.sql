ALTER TABLE "IdempotencyKey"
  ADD COLUMN "responseBytes" INTEGER,
  ADD COLUMN "processingExpiresAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours');

CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");
CREATE INDEX "IdempotencyKey_status_processingExpiresAt_idx"
  ON "IdempotencyKey"("status", "processingExpiresAt");

DROP TABLE IF EXISTS "RateLimitBucket";

-- NOT VALID avoids blocking rollout on historical legacy rows while enforcing
-- these invariants for every new or updated record.
ALTER TABLE "App" ADD CONSTRAINT "App_environment_check"
  CHECK ("environment" IN ('sandbox', 'production')) NOT VALID;
ALTER TABLE "App" ADD CONSTRAINT "App_status_check"
  CHECK ("status" IN ('active', 'disabled', 'suspended')) NOT VALID;
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_status_check"
  CHECK ("status" IN ('active', 'revoked')) NOT VALID;
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_status_check"
  CHECK ("status" IN ('active', 'disabled')) NOT VALID;
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_status_check"
  CHECK ("status" IN ('pending', 'completed')) NOT VALID;
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_response_size_check"
  CHECK ("responseBytes" IS NULL OR "responseBytes" >= 0) NOT VALID;
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_amount_check"
  CHECK ("amount" ~ '^[1-9][0-9]*$') NOT VALID;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_amount_check"
  CHECK ("amount" ~ '^[1-9][0-9]*$') NOT VALID;
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_amount_check"
  CHECK ("amount" ~ '^[1-9][0-9]*$') NOT VALID;
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_amount_check"
  CHECK ("amount" ~ '^[1-9][0-9]*$') NOT VALID;
