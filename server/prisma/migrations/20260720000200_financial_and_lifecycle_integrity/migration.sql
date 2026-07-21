-- Abort with actionable information before creating external identity indexes.
DO $$
DECLARE
  duplicates text;
BEGIN
  SELECT string_agg(identity_type || '=' || duplicate_count, ', ' ORDER BY identity_type)
  INTO duplicates
  FROM (
    SELECT 'Transaction(rail,network,type,txHash,escrowId)' AS identity_type, count(*)::text AS duplicate_count
    FROM (
      SELECT rail, network, type, "txHash", "escrowId" FROM "Transaction"
      WHERE "txHash" IS NOT NULL AND "escrowId" IS NOT NULL
      GROUP BY rail, network, type, "txHash", "escrowId" HAVING count(*) > 1
    ) rows
    HAVING count(*) > 0
    UNION ALL
    SELECT 'MilestoneSettlement(network,direction,txHash,milestoneId)', count(*)::text
    FROM (
      SELECT network, direction, "txHash", "milestoneId" FROM "MilestoneSettlement"
      WHERE "txHash" IS NOT NULL AND "milestoneId" IS NOT NULL
      GROUP BY network, direction, "txHash", "milestoneId" HAVING count(*) > 1
    ) rows
    HAVING count(*) > 0
    UNION ALL
    SELECT 'MilestoneSettlement(network,direction,paymentReference,milestoneId)', count(*)::text
    FROM (
      SELECT network, direction, "paymentReference", "milestoneId" FROM "MilestoneSettlement"
      WHERE "paymentReference" IS NOT NULL AND "milestoneId" IS NOT NULL
      GROUP BY network, direction, "paymentReference", "milestoneId" HAVING count(*) > 1
    ) rows
    HAVING count(*) > 0
  ) audit;

  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'External transaction identity migration blocked: %', duplicates;
  END IF;
END $$;

ALTER TABLE "Agreement"
  ADD COLUMN "reserveFundingQuoteSource" TEXT,
  ADD COLUMN "reserveFundingQuotedAt" TIMESTAMP(3);

ALTER TABLE "Milestone"
  ADD COLUMN "releaseQuoteSource" TEXT,
  ADD COLUMN "releaseQuotedAt" TIMESTAMP(3);

ALTER TABLE "IdempotencyKey"
  ALTER COLUMN "responseBodyJson" TYPE JSONB
  USING CASE WHEN "responseBodyJson" IS NULL THEN NULL ELSE "responseBodyJson"::jsonb END;

UPDATE "Agreement"
SET "reserveFundingQuoteSource" = 'legacy_unknown',
    "reserveFundingQuotedAt" = "createdAt"
WHERE "reserveFundingQuoteUsdPerCkb" IS NOT NULL;

UPDATE "Milestone"
SET "releaseQuoteSource" = 'legacy_unknown',
    "releaseQuotedAt" = "updatedAt"
WHERE "releaseQuoteUsdPerCkb" IS NOT NULL;

UPDATE "IdempotencyKey"
SET "responseBytes" = octet_length("responseBodyJson"::text)
WHERE status = 'completed' AND "responseBodyJson" IS NOT NULL AND "responseBytes" IS NULL;

CREATE UNIQUE INDEX "Transaction_rail_network_type_txHash_escrowId_key"
  ON "Transaction"("rail", "network", "type", "txHash", "escrowId");
CREATE UNIQUE INDEX "MilestoneSettlement_tx_identity_key"
  ON "MilestoneSettlement"("network", "direction", "txHash", "milestoneId");
CREATE UNIQUE INDEX "MilestoneSettlement_payment_identity_key"
  ON "MilestoneSettlement"("network", "direction", "paymentReference", "milestoneId");

ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_status_lifecycle_check"
  CHECK (status IN ('not_created','awaiting_funding','funding_detected','funded','release_pending','released','refund_pending','refunded','failed')) NOT VALID;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_status_lifecycle_check"
  CHECK (status IN ('pending','confirmed','failed')) NOT VALID;
ALTER TABLE "Proof" ADD CONSTRAINT "Proof_status_lifecycle_check"
  CHECK (status IN ('submitted','under_review','accepted','rejected','needs_changes','disputed')) NOT VALID;
ALTER TABLE "Review" ADD CONSTRAINT "Review_decision_check"
  CHECK (decision IN ('approved','rejected','needs_changes')) NOT VALID;
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_status_lifecycle_check"
  CHECK (status IN ('open','awaiting_response','under_review','resolved_release','resolved_refund','resolved_split','cancelled')) NOT VALID;
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_status_lifecycle_check"
  CHECK (status IN ('PENDING','DELIVERED','FAILED','RETRY')) NOT VALID;
ALTER TABLE "MilestoneSettlement" ADD CONSTRAINT "MilestoneSettlement_lifecycle_check"
  CHECK (status IN ('PENDING','CONFIRMED','FAILED') AND direction IN ('FUNDING','PAYOUT','REFUND') AND network IN ('CKB','FIBER','INTERNAL')) NOT VALID;
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_status_lifecycle_check"
  CHECK (status IN ('QUEUED','RUNNING','RETRY','COMPLETED','DEAD_LETTER')) NOT VALID;

-- uint64 shannons: 18,446,744,073,709,551,615.
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_amount_uint64_check"
  CHECK ("amount" !~ '^[0-9]+$' OR length("amount") < 20 OR (length("amount") = 20 AND "amount" <= '18446744073709551615')) NOT VALID;
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_amount_uint64_check"
  CHECK ("amount" !~ '^[0-9]+$' OR length("amount") < 20 OR (length("amount") = 20 AND "amount" <= '18446744073709551615')) NOT VALID;
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_amount_uint64_check"
  CHECK ("amount" !~ '^[0-9]+$' OR length("amount") < 20 OR (length("amount") = 20 AND "amount" <= '18446744073709551615')) NOT VALID;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_amount_uint64_check"
  CHECK ("amount" !~ '^[0-9]+$' OR length("amount") < 20 OR (length("amount") = 20 AND "amount" <= '18446744073709551615')) NOT VALID;
ALTER TABLE "MilestoneSettlement" ADD CONSTRAINT "MilestoneSettlement_amount_check"
  CHECK ("amount" ~ '^[1-9][0-9]*$' AND (length("amount") < 20 OR (length("amount") = 20 AND "amount" <= '18446744073709551615'))) NOT VALID;
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_reserve_amount_check"
  CHECK ("reserveCkbLocked" ~ '^[0-9]+$' AND "reserveCkbRemaining" ~ '^[0-9]+$') NOT VALID;
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_released_amount_check"
  CHECK ("releasedCkbAmount" IS NULL OR "releasedCkbAmount" ~ '^[1-9][0-9]*$') NOT VALID;
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_split_amounts_check"
  CHECK (("workerAmount" IS NULL AND "clientAmount" IS NULL) OR ("workerAmount" ~ '^[1-9][0-9]*$' AND "clientAmount" ~ '^[1-9][0-9]*$')) NOT VALID;

ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_reserve_quote_consistency_check"
  CHECK (
    ("reserveFundingQuoteUsdPerCkb" IS NULL AND "reserveFundingQuoteSource" IS NULL AND "reserveFundingQuotedAt" IS NULL)
    OR ("reserveFundingQuoteUsdPerCkb" > 0 AND "reserveFundingQuoteSource" IS NOT NULL AND "reserveFundingQuotedAt" IS NOT NULL)
  ) NOT VALID;
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_release_quote_consistency_check"
  CHECK (
    (("releaseQuoteUsdPerCkb" IS NULL AND "releaseQuoteSource" IS NULL AND "releaseQuotedAt" IS NULL)
    OR ("releaseQuoteUsdPerCkb" > 0 AND "releaseQuoteSource" IS NOT NULL AND "releaseQuotedAt" IS NOT NULL))
    AND ("releasedUsdValue" IS NULL OR "releasedUsdValue" >= 0)
  ) NOT VALID;
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_completion_consistency_check"
  CHECK (
    status <> 'completed'
    OR ("responseStatus" IS NOT NULL AND "responseBodyJson" IS NOT NULL AND "responseBytes" IS NOT NULL AND "responseBytes" >= 0)
  ) NOT VALID;
