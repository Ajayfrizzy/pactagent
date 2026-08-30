-- Phase 2 lifecycle, allocation, and active-scope invariants.
-- Unknown historical values and duplicate active scopes abort this migration;
-- operators must reconcile them from source records rather than lose data.

-- Normalize only case variants of values that are already canonical.
UPDATE "Agreement"
SET status = CASE status
  WHEN 'PAID' THEN 'released'
  ELSE lower(status)
END
WHERE status IN (
  'DRAFT','FUNDED','PROOF_SUBMITTED','UNDER_REVIEW','APPROVED','PAID',
  'DISPUTED','CANCELLED','REFUNDED','EXPIRED'
);

UPDATE "Agreement"
SET status = lower(status)
WHERE lower(status) IN (
  'draft','pending_acceptance','accepted','funding_required','funded','in_progress',
  'proof_submitted','under_review','approved','release_pending','released','rejected',
  'disputed','cancelled','refunded','expired'
) AND status <> lower(status);

UPDATE "Milestone"
SET status = CASE status
  WHEN 'ACTIVE' THEN 'in_progress'
  WHEN 'PAID' THEN 'released'
  ELSE lower(status)
END
WHERE status IN (
  'PENDING','ACTIVE','PROOF_SUBMITTED','UNDER_REVIEW','APPROVED','PAID',
  'DISPUTED','CANCELLED','REFUNDED','EXPIRED'
);

UPDATE "Milestone"
SET status = lower(status)
WHERE lower(status) IN (
  'pending','funding_required','funded','in_progress','proof_submitted','under_review',
  'approved','released','rejected','disputed','refunded','cancelled','expired'
) AND status <> lower(status);

UPDATE "Milestone" milestone
SET currency = agreement.currency
FROM "Agreement" agreement
WHERE milestone.currency IS NULL
  AND agreement.id = milestone."agreementId"
  AND agreement."appId" = milestone."appId";

UPDATE "Proof"
SET status = lower(status)
WHERE lower(status) IN ('submitted','under_review','accepted','rejected','needs_changes','disputed')
  AND status <> lower(status);

UPDATE "Proof"
SET "proofType" = CASE "proofType"
  WHEN 'URL' THEN 'url'
  WHEN 'TEXT' THEN 'text'
  WHEN 'FILE_HASH' THEN 'file'
  ELSE "proofType"
END
WHERE "proofType" IN ('URL','TEXT','FILE_HASH');

UPDATE "Dispute"
SET status = lower(status)
WHERE lower(status) IN (
  'open','awaiting_response','under_review','resolved_release','resolved_refund',
  'resolved_split','cancelled'
) AND status <> lower(status);

UPDATE "Escrow"
SET status = lower(status)
WHERE lower(status) IN (
  'not_created','awaiting_funding','funding_detected','funded','release_pending',
  'released','refund_pending','refunded','failed'
) AND status <> lower(status);

UPDATE "Transaction"
SET status = lower(status)
WHERE lower(status) IN ('pending','confirmed','failed') AND status <> lower(status);

ALTER TABLE "Agreement" ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE "Milestone" ALTER COLUMN status SET DEFAULT 'pending';

DO $$
DECLARE
  violations text;
BEGIN
  SELECT string_agg(check_name || '=' || detail, '; ' ORDER BY check_name)
  INTO violations
  FROM (
    SELECT 'Agreement.status' AS check_name, array_agg(DISTINCT status)::text AS detail
    FROM "Agreement"
    WHERE status NOT IN (
      'draft','pending_acceptance','accepted','funding_required','funded','in_progress',
      'proof_submitted','under_review','approved','release_pending','released','rejected',
      'disputed','cancelled','refunded','expired'
    ) HAVING count(*) > 0
    UNION ALL
    SELECT 'App.environment/status', array_agg(DISTINCT environment || '/' || status)::text
    FROM "App"
    WHERE environment NOT IN ('sandbox','production') OR status NOT IN ('active','disabled','suspended')
    HAVING count(*) > 0
    UNION ALL
    SELECT 'ApiKey.environment/status', array_agg(DISTINCT environment || '/' || status)::text
    FROM "ApiKey"
    WHERE environment NOT IN ('sandbox','production') OR status NOT IN ('active','revoked')
    HAVING count(*) > 0
    UNION ALL
    SELECT 'Agreement.settlementStatus', array_agg(DISTINCT "settlementStatus")::text
    FROM "Agreement"
    WHERE "settlementStatus" NOT IN (
      'UNFUNDED','FUNDING_PENDING','FUNDED','PAYOUT_PENDING','PAYOUT_CONFIRMED',
      'REFUND_PENDING','REFUND_CONFIRMED','FAILED'
    ) HAVING count(*) > 0
    UNION ALL
    SELECT 'Agreement.releaseMode', array_agg(DISTINCT "releaseMode")::text
    FROM "Agreement" WHERE "releaseMode" NOT IN ('manual','milestone','automatic') HAVING count(*) > 0
    UNION ALL
    SELECT 'Agreement.disputeMode', array_agg(DISTINCT "disputeMode")::text
    FROM "Agreement" WHERE "disputeMode" NOT IN ('app_managed','pactagent_managed') HAVING count(*) > 0
    UNION ALL
    SELECT 'Milestone.status', array_agg(DISTINCT status)::text
    FROM "Milestone"
    WHERE status NOT IN (
      'pending','funding_required','funded','in_progress','proof_submitted','under_review',
      'approved','released','rejected','disputed','refunded','cancelled','expired'
    ) HAVING count(*) > 0
    UNION ALL
    SELECT 'Proof.status', array_agg(DISTINCT status)::text
    FROM "Proof"
    WHERE status NOT IN ('submitted','under_review','accepted','rejected','needs_changes','disputed')
    HAVING count(*) > 0
    UNION ALL
    SELECT 'Proof.proofType', array_agg(DISTINCT "proofType")::text
    FROM "Proof" WHERE "proofType" NOT IN ('text','url','file','github','mixed') HAVING count(*) > 0
    UNION ALL
    SELECT 'Review.decision', array_agg(DISTINCT decision)::text
    FROM "Review" WHERE decision NOT IN ('approved','rejected','needs_changes') HAVING count(*) > 0
    UNION ALL
    SELECT 'Dispute.status', array_agg(DISTINCT status)::text
    FROM "Dispute"
    WHERE status NOT IN (
      'open','awaiting_response','under_review','resolved_release','resolved_refund','resolved_split','cancelled'
    ) HAVING count(*) > 0
    UNION ALL
    SELECT 'Escrow.status', array_agg(DISTINCT status)::text
    FROM "Escrow"
    WHERE status NOT IN (
      'not_created','awaiting_funding','funding_detected','funded','release_pending',
      'released','refund_pending','refunded','failed'
    ) HAVING count(*) > 0
    UNION ALL
    SELECT 'Escrow.rail/network', array_agg(DISTINCT rail || '/' || network)::text
    FROM "Escrow"
    WHERE NOT (
      (rail IN ('mock','manual') AND network = 'sandbox')
      OR (rail = 'ckb' AND network IN ('testnet','mainnet'))
    ) HAVING count(*) > 0
    UNION ALL
    SELECT 'Transaction.type', array_agg(DISTINCT type)::text
    FROM "Transaction" WHERE type NOT IN ('lock','release','refund','manual_adjustment') HAVING count(*) > 0
    UNION ALL
    SELECT 'Transaction.status', array_agg(DISTINCT status)::text
    FROM "Transaction" WHERE status NOT IN ('pending','confirmed','failed') HAVING count(*) > 0
    UNION ALL
    SELECT 'Transaction.rail/network', array_agg(DISTINCT rail || '/' || network)::text
    FROM "Transaction"
    WHERE NOT (
      (rail IN ('mock','manual') AND network = 'sandbox')
      OR (rail = 'ckb' AND network IN ('testnet','mainnet'))
    ) HAVING count(*) > 0
  ) invalid_values;

  IF violations IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 2 lifecycle constraint migration blocked by invalid values: %', violations;
  END IF;
END $$;

DO $$
DECLARE
  violations text;
BEGIN
  SELECT string_agg(check_name || '=' || violation_count, ', ' ORDER BY check_name)
  INTO violations
  FROM (
    SELECT 'Agreement.amount' AS check_name, count(*)::text AS violation_count
    FROM "Agreement" WHERE amount !~ '^[1-9][0-9]*$' HAVING count(*) > 0
    UNION ALL
    SELECT 'Milestone.amount', count(*)::text
    FROM "Milestone" WHERE amount !~ '^[1-9][0-9]*$' HAVING count(*) > 0
    UNION ALL
    SELECT 'Escrow.amount', count(*)::text
    FROM "Escrow" WHERE amount !~ '^[1-9][0-9]*$' HAVING count(*) > 0
    UNION ALL
    SELECT 'Transaction.amount', count(*)::text
    FROM "Transaction" WHERE amount !~ '^[1-9][0-9]*$' HAVING count(*) > 0
  ) invalid_amounts;

  IF violations IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 2 financial migration blocked by malformed amounts: %', violations;
  END IF;
END $$;

DO $$
DECLARE
  violations text;
BEGIN
  SELECT string_agg(check_name || '=' || violation_count, ', ' ORDER BY check_name)
  INTO violations
  FROM (
    SELECT 'active agreement escrows' AS check_name, count(*)::text AS violation_count
    FROM (
      SELECT "appId", "agreementId"
      FROM "Escrow"
      WHERE "milestoneId" IS NULL
        AND status IN (
          'not_created','awaiting_funding','funding_detected','funded',
          'release_pending','refund_pending','failed'
        )
      GROUP BY "appId", "agreementId"
      HAVING count(*) > 1
    ) duplicate_scopes
    HAVING count(*) > 0
    UNION ALL
    SELECT 'active milestone escrows', count(*)::text
    FROM (
      SELECT "appId", "agreementId", "milestoneId"
      FROM "Escrow"
      WHERE "milestoneId" IS NOT NULL
        AND status IN (
          'not_created','awaiting_funding','funding_detected','funded',
          'release_pending','refund_pending','failed'
        )
      GROUP BY "appId", "agreementId", "milestoneId"
      HAVING count(*) > 1
    ) duplicate_scopes
    HAVING count(*) > 0
    UNION ALL
    SELECT 'unresolved disputes', count(*)::text
    FROM (
      SELECT "appId", "agreementId", "milestoneId"
      FROM "Dispute"
      WHERE status IN ('open','awaiting_response','under_review')
      GROUP BY "appId", "agreementId", "milestoneId"
      HAVING count(*) > 1
    ) duplicate_scopes
    HAVING count(*) > 0
    UNION ALL
    SELECT 'milestone over-allocation', count(*)::text
    FROM (
      SELECT agreement.id
      FROM "Agreement" agreement
      JOIN "Milestone" milestone
        ON milestone."appId" = agreement."appId" AND milestone."agreementId" = agreement.id
      GROUP BY agreement.id, agreement.amount
      HAVING sum(milestone.amount::numeric) > agreement.amount::numeric
    ) over_allocated
    HAVING count(*) > 0
    UNION ALL
    SELECT 'milestone currency mismatch', count(*)::text
    FROM "Milestone" milestone
    JOIN "Agreement" agreement
      ON agreement.id = milestone."agreementId" AND agreement."appId" = milestone."appId"
    WHERE milestone.currency IS DISTINCT FROM agreement.currency
    HAVING count(*) > 0
    UNION ALL
    SELECT 'escrow scope amount/currency mismatch', count(*)::text
    FROM "Escrow" escrow
    JOIN "Agreement" agreement
      ON agreement.id = escrow."agreementId" AND agreement."appId" = escrow."appId"
    LEFT JOIN "Milestone" milestone
      ON milestone.id = escrow."milestoneId" AND milestone."appId" = escrow."appId"
    WHERE escrow.currency IS DISTINCT FROM agreement.currency
       OR escrow.amount::numeric > COALESCE(milestone.amount, agreement.amount)::numeric
    HAVING count(*) > 0
  ) audit;

  IF violations IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 2 financial/uniqueness migration blocked: %', violations;
  END IF;
END $$;

CREATE UNIQUE INDEX "Escrow_one_active_agreement_scope_key"
  ON "Escrow"("appId", "agreementId")
  WHERE "milestoneId" IS NULL
    AND status IN (
      'not_created','awaiting_funding','funding_detected','funded',
      'release_pending','refund_pending','failed'
    );

CREATE UNIQUE INDEX "Escrow_one_active_milestone_scope_key"
  ON "Escrow"("appId", "agreementId", "milestoneId")
  WHERE "milestoneId" IS NOT NULL
    AND status IN (
      'not_created','awaiting_funding','funding_detected','funded',
      'release_pending','refund_pending','failed'
    );

CREATE UNIQUE INDEX "Dispute_one_unresolved_agreement_scope_key"
  ON "Dispute"("appId", "agreementId")
  WHERE "milestoneId" IS NULL AND status IN ('open','awaiting_response','under_review');

CREATE UNIQUE INDEX "Dispute_one_unresolved_milestone_scope_key"
  ON "Dispute"("appId", "agreementId", "milestoneId")
  WHERE "milestoneId" IS NOT NULL AND status IN ('open','awaiting_response','under_review');

ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_environment_check"
  CHECK (environment IN ('sandbox','production'));
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_status_check"
  CHECK (status IN (
    'draft','pending_acceptance','accepted','funding_required','funded','in_progress',
    'proof_submitted','under_review','approved','release_pending','released','rejected',
    'disputed','cancelled','refunded','expired'
  ));
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_settlement_status_check"
  CHECK ("settlementStatus" IN (
    'UNFUNDED','FUNDING_PENDING','FUNDED','PAYOUT_PENDING','PAYOUT_CONFIRMED',
    'REFUND_PENDING','REFUND_CONFIRMED','FAILED'
  ));
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_policy_check"
  CHECK ("releaseMode" IN ('manual','milestone','automatic') AND "disputeMode" IN ('app_managed','pactagent_managed'));
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_status_check"
  CHECK (status IN (
    'pending','funding_required','funded','in_progress','proof_submitted','under_review',
    'approved','released','rejected','disputed','refunded','cancelled','expired'
  ));
ALTER TABLE "Milestone" ALTER COLUMN currency SET NOT NULL;
ALTER TABLE "Proof" ADD CONSTRAINT "Proof_type_check"
  CHECK ("proofType" IN ('text','url','file','github','mixed'));
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_rail_network_check"
  CHECK (
    (rail IN ('mock','manual') AND network = 'sandbox')
    OR (rail = 'ckb' AND network IN ('testnet','mainnet'))
  );
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_type_check"
  CHECK (type IN ('lock','release','refund','manual_adjustment'));
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_rail_network_check"
  CHECK (
    (rail IN ('mock','manual') AND network = 'sandbox')
    OR (rail = 'ckb' AND network IN ('testnet','mainnet'))
  );

ALTER TABLE "Dispute" DROP CONSTRAINT IF EXISTS "Dispute_split_amounts_check";
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_split_amounts_check"
  CHECK (
    ("resolutionType" IS DISTINCT FROM 'split' AND "workerAmount" IS NULL AND "clientAmount" IS NULL)
    OR (
      "resolutionType" = 'split'
      AND "workerAmount" ~ '^(0|[1-9][0-9]*)$'
      AND "clientAmount" ~ '^(0|[1-9][0-9]*)$'
    )
  );

ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_resolution_type_check"
  CHECK ("resolutionType" IS NULL OR "resolutionType" IN ('release','refund','split'));

CREATE FUNCTION enforce_dispute_settlement_split()
RETURNS trigger AS $$
DECLARE
  funded_amount numeric;
BEGIN
  IF NEW."resolutionType" IS DISTINCT FROM 'split' THEN
    RETURN NEW;
  END IF;

  SELECT amount::numeric INTO funded_amount
  FROM "Escrow"
  WHERE "appId" = NEW."appId"
    AND "agreementId" = NEW."agreementId"
    AND "milestoneId" IS NOT DISTINCT FROM NEW."milestoneId"
    AND status = 'funded';

  IF funded_amount IS NULL THEN
    RAISE EXCEPTION 'Split resolution requires a funded escrow.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."workerAmount"::numeric > funded_amount
     OR NEW."clientAmount"::numeric > funded_amount
     OR NEW."workerAmount"::numeric + NEW."clientAmount"::numeric <> funded_amount THEN
    RAISE EXCEPTION 'Dispute split must exactly equal the funded escrow amount.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Dispute_settlement_split_invariant"
BEFORE INSERT OR UPDATE OF "resolutionType", "workerAmount", "clientAmount" ON "Dispute"
FOR EACH ROW EXECUTE FUNCTION enforce_dispute_settlement_split();

-- Serialize all milestone allocation writers on the parent agreement, including
-- direct SQL clients that bypass the application service.
CREATE FUNCTION enforce_milestone_allocation()
RETURNS trigger AS $$
DECLARE
  agreement_amount numeric;
  agreement_currency text;
  allocated numeric;
BEGIN
  SELECT amount::numeric, currency
  INTO agreement_amount, agreement_currency
  FROM "Agreement"
  WHERE id = NEW."agreementId" AND "appId" = NEW."appId"
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF NEW.currency IS DISTINCT FROM agreement_currency THEN
    RAISE EXCEPTION 'Milestone currency must match agreement currency.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(sum(amount::numeric), 0)
  INTO allocated
  FROM "Milestone"
  WHERE "appId" = NEW."appId"
    AND "agreementId" = NEW."agreementId"
    AND id IS DISTINCT FROM NEW.id;

  IF allocated + NEW.amount::numeric > agreement_amount THEN
    RAISE EXCEPTION 'Milestone allocation exceeds agreement amount.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Milestone_allocation_invariant"
BEFORE INSERT OR UPDATE OF amount, currency, "agreementId", "appId" ON "Milestone"
FOR EACH ROW EXECUTE FUNCTION enforce_milestone_allocation();

CREATE FUNCTION enforce_escrow_scope_amount()
RETURNS trigger AS $$
DECLARE
  agreement_amount numeric;
  agreement_currency text;
  milestone_amount numeric;
BEGIN
  SELECT amount::numeric, currency
  INTO agreement_amount, agreement_currency
  FROM "Agreement"
  WHERE id = NEW."agreementId" AND "appId" = NEW."appId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow agreement scope does not exist.' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.currency IS DISTINCT FROM agreement_currency THEN
    RAISE EXCEPTION 'Escrow currency must match agreement currency.' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."milestoneId" IS NOT NULL THEN
    SELECT amount::numeric INTO milestone_amount
    FROM "Milestone"
    WHERE id = NEW."milestoneId" AND "appId" = NEW."appId" AND "agreementId" = NEW."agreementId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Escrow milestone does not belong to agreement scope.' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NEW.amount::numeric > milestone_amount THEN
      RAISE EXCEPTION 'Escrow amount exceeds milestone amount.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.rail = 'ckb' AND NEW.amount::numeric <> milestone_amount THEN
      RAISE EXCEPTION 'CKB escrow amount must exactly equal milestone amount.' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.amount::numeric > agreement_amount THEN
    RAISE EXCEPTION 'Escrow amount exceeds agreement amount.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Escrow_scope_amount_invariant"
BEFORE INSERT OR UPDATE OF amount, currency, "agreementId", "milestoneId", "appId" ON "Escrow"
FOR EACH ROW EXECUTE FUNCTION enforce_escrow_scope_amount();

ALTER TABLE "App" VALIDATE CONSTRAINT "App_environment_check";
ALTER TABLE "App" VALIDATE CONSTRAINT "App_status_check";
ALTER TABLE "ApiKey" VALIDATE CONSTRAINT "ApiKey_status_check";
ALTER TABLE "WebhookEndpoint" VALIDATE CONSTRAINT "WebhookEndpoint_status_check";
ALTER TABLE "IdempotencyKey" VALIDATE CONSTRAINT "IdempotencyKey_status_check";
ALTER TABLE "Escrow" VALIDATE CONSTRAINT "Escrow_status_lifecycle_check";
ALTER TABLE "Transaction" VALIDATE CONSTRAINT "Transaction_status_lifecycle_check";
ALTER TABLE "Proof" VALIDATE CONSTRAINT "Proof_status_lifecycle_check";
ALTER TABLE "Review" VALIDATE CONSTRAINT "Review_decision_check";
ALTER TABLE "Dispute" VALIDATE CONSTRAINT "Dispute_status_lifecycle_check";
ALTER TABLE "WebhookDelivery" VALIDATE CONSTRAINT "WebhookDelivery_status_lifecycle_check";
ALTER TABLE "AgentJob" VALIDATE CONSTRAINT "AgentJob_status_lifecycle_check";
ALTER TABLE "Agreement" VALIDATE CONSTRAINT "Agreement_amount_check";
ALTER TABLE "Agreement" VALIDATE CONSTRAINT "Agreement_amount_uint64_check";
ALTER TABLE "Milestone" VALIDATE CONSTRAINT "Milestone_amount_check";
ALTER TABLE "Milestone" VALIDATE CONSTRAINT "Milestone_amount_uint64_check";
ALTER TABLE "Escrow" VALIDATE CONSTRAINT "Escrow_amount_check";
ALTER TABLE "Escrow" VALIDATE CONSTRAINT "Escrow_amount_uint64_check";
ALTER TABLE "Transaction" VALIDATE CONSTRAINT "Transaction_amount_check";
ALTER TABLE "Transaction" VALIDATE CONSTRAINT "Transaction_amount_uint64_check";
