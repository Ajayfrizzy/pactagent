-- Snapshot deprecated columns before removing them from operational models.
ALTER TABLE public."App" RENAME COLUMN "ownerUserId" TO "ownerId";
ALTER INDEX IF EXISTS public."App_ownerUserId_createdAt_idx" RENAME TO "App_ownerId_createdAt_idx";
ALTER INDEX IF EXISTS public."App_ownerUserId_slug_key" RENAME TO "App_ownerId_slug_key";

CREATE TABLE legacy_product_archive."AgreementFields" AS
SELECT
  id, "clientAddress", "workerAddress", "arbitratorAddress", "workerFiberPubkey",
  "proofType", "reviewerMode", "releaseMode" AS "legacyReleaseMode",
  "payoutNetwork", "escrowModel", "escrowAddress", "escrowLockCodeHash",
  "escrowLockHashType", "escrowLockArgs", "agreementDigest", "milestoneDigest",
  "pricingMode", "reserveCkbLocked", "reserveCkbRemaining",
  "reserveFundingQuoteUsdPerCkb", "reserveFundingQuoteSource",
  "reserveFundingQuotedAt", "reserveHealthStatus", "lastSettlementError",
  "ckbTxHashCreate", "ckbTxHashFund", "ckbTxHashRelease", "fiberPaymentReference"
FROM public."Agreement";

CREATE TABLE legacy_product_archive."MilestoneFields" AS
SELECT
  id, "targetUsd", "releaseQuoteUsdPerCkb", "releaseQuoteSource",
  "releaseQuotedAt", "releasedCkbAmount", "releasedUsdValue",
  "escrowFundingTxHash", "escrowOutputIndex", "escrowCellData", "refundTimeoutBlock"
FROM public."Milestone";

CREATE TABLE legacy_product_archive."ProofAutomationFields" AS
SELECT id, "reviewStatus", "lastCheckedAt"
FROM public."Proof";

CREATE TABLE legacy_product_archive."DisputeFields" AS
SELECT
  id, "openedBy", "evidenceNotes", "aiSummary", "aiRecommendation",
  "aiConfidence", "aiRationale"
FROM public."Dispute";

CREATE TABLE legacy_product_archive."WebhookEndpointFields" AS
SELECT
  id, "ownerAddress", label, "targetUrl", "eventTypesJson",
  '[redacted]'::TEXT AS "signingSecret", "isActive"
FROM public."WebhookEndpoint";

CREATE TABLE legacy_product_archive."UnsupportedAgentJob" AS
SELECT * FROM public."AgentJob" WHERE kind <> 'DELIVER_WEBHOOK';
DELETE FROM public."AgentJob" WHERE kind <> 'DELIVER_WEBHOOK';

-- App-scope durable jobs directly so app-level webhook events do not require an agreement.
ALTER TABLE public."AgentJob" ADD COLUMN "appId" TEXT;
UPDATE public."AgentJob" job
SET "appId" = agreement."appId"
FROM public."Agreement" agreement
WHERE job."agreementId" = agreement.id;
UPDATE public."AgentJob" job
SET "appId" = delivery."appId"
FROM public."WebhookDelivery" delivery
WHERE job."appId" IS NULL
  AND delivery.id = NULLIF(legacy_product_archive.try_parse_jsonb(job."payloadJson") ->> 'deliveryId', '');

CREATE TABLE legacy_product_archive."UnscopedAgentJob" AS
SELECT * FROM public."AgentJob" WHERE "appId" IS NULL;
DELETE FROM public."AgentJob" WHERE "appId" IS NULL;

UPDATE public."AgentJob" SET queue = 'webhook' WHERE kind = 'DELIVER_WEBHOOK';
ALTER TABLE public."AgentJob" ALTER COLUMN "appId" SET NOT NULL;
ALTER TABLE public."AgentJob" DROP CONSTRAINT "AgentJob_agreementId_fkey";
ALTER TABLE public."AgentJob"
  ADD CONSTRAINT "AgentJob_appId_fkey"
    FOREIGN KEY ("appId") REFERENCES public."App"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AgentJob_agreementId_appId_fkey"
    FOREIGN KEY ("agreementId", "appId") REFERENCES public."Agreement"(id, "appId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AgentJob_appId_createdAt_idx" ON public."AgentJob"("appId", "createdAt");
ALTER TABLE public."AgentJob" DROP CONSTRAINT IF EXISTS "AgentJob_queue_check";
ALTER TABLE public."AgentJob" ALTER COLUMN queue SET DEFAULT 'webhook';
ALTER TABLE public."AgentJob" ADD CONSTRAINT "AgentJob_queue_check"
  CHECK (queue = 'webhook') NOT VALID;
ALTER TABLE public."AgentJob" ADD CONSTRAINT "AgentJob_kind_check"
  CHECK (kind IN ('DELIVER_WEBHOOK')) NOT VALID;

CREATE TABLE legacy_product_archive."DeprecatedWorkerHeartbeat" AS
SELECT * FROM public."WorkerHeartbeat" WHERE service <> 'webhook';
DELETE FROM public."WorkerHeartbeat" WHERE service <> 'webhook';
ALTER TABLE public."WorkerHeartbeat" ALTER COLUMN service SET DEFAULT 'webhook';

-- Remove duplicated legacy webhook columns after canonical fields are populated.
UPDATE public."WebhookEndpoint"
SET
  url = COALESCE(url, "targetUrl"),
  "encryptionKeyVersion" = CASE
    WHEN "secretCiphertext" IS NULL THEN NULL
    ELSE "encryptionKeyVersion"
  END,
  status = CASE
    WHEN "isActive"
      AND "secretHash" IS NOT NULL
      AND "secretCiphertext" IS NOT NULL
      AND "encryptionKeyVersion" IS NOT NULL
      THEN COALESCE(NULLIF(status, ''), 'active')
    ELSE 'disabled'
  END;
ALTER TABLE public."WebhookEndpoint"
  ALTER COLUMN "appId" SET NOT NULL,
  ALTER COLUMN url SET NOT NULL,
  DROP COLUMN "ownerAddress",
  DROP COLUMN label,
  DROP COLUMN "targetUrl",
  DROP COLUMN "eventTypesJson",
  DROP COLUMN "signingSecret",
  DROP COLUMN "isActive";
ALTER TABLE public."WebhookEndpoint"
  ADD CONSTRAINT "WebhookEndpoint_active_secret_material_check"
  CHECK (
    status <> 'active'
    OR (
      "secretHash" IS NOT NULL
      AND "secretCiphertext" IS NOT NULL
      AND "encryptionKeyVersion" IS NOT NULL
    )
  );
ALTER TABLE public."WebhookDelivery" ALTER COLUMN "appId" SET NOT NULL;

-- Existing v1 fields become the only agreement policy fields.
UPDATE public."Agreement"
SET
  "infrastructureReleaseMode" = COALESCE(
    "infrastructureReleaseMode",
    CASE WHEN "releaseMode" = 'FULL' THEN 'automatic' ELSE 'milestone' END
  ),
  "disputeMode" = COALESCE("disputeMode", 'app_managed');

DROP TRIGGER IF EXISTS "Agreement_funded_terms_immutable" ON public."Agreement";
DROP TRIGGER IF EXISTS "Milestone_funded_terms_immutable" ON public."Milestone";
DROP TRIGGER IF EXISTS "Milestone_funded_membership_immutable" ON public."Milestone";
DROP FUNCTION IF EXISTS prevent_funded_agreement_term_changes();
DROP FUNCTION IF EXISTS prevent_funded_milestone_term_changes();
DROP FUNCTION IF EXISTS prevent_funded_milestone_membership_changes();

ALTER TABLE public."Agreement" DROP CONSTRAINT IF EXISTS "Agreement_reserve_amount_check";
ALTER TABLE public."Agreement" DROP CONSTRAINT IF EXISTS "Agreement_reserve_quote_consistency_check";
ALTER TABLE public."Milestone" DROP CONSTRAINT IF EXISTS "Milestone_released_amount_check";
ALTER TABLE public."Milestone" DROP CONSTRAINT IF EXISTS "Milestone_release_quote_consistency_check";
DROP INDEX IF EXISTS public."Agreement_clientAddress_createdAt_idx";
DROP INDEX IF EXISTS public."Agreement_workerAddress_createdAt_idx";

ALTER TABLE public."Agreement"
  DROP COLUMN "clientAddress",
  DROP COLUMN "workerAddress",
  DROP COLUMN "arbitratorAddress",
  DROP COLUMN "workerFiberPubkey",
  DROP COLUMN "proofType",
  DROP COLUMN "reviewerMode",
  DROP COLUMN "releaseMode",
  DROP COLUMN "payoutNetwork",
  DROP COLUMN "escrowModel",
  DROP COLUMN "escrowAddress",
  DROP COLUMN "escrowLockCodeHash",
  DROP COLUMN "escrowLockHashType",
  DROP COLUMN "escrowLockArgs",
  DROP COLUMN "agreementDigest",
  DROP COLUMN "milestoneDigest",
  DROP COLUMN "pricingMode",
  DROP COLUMN "reserveCkbLocked",
  DROP COLUMN "reserveCkbRemaining",
  DROP COLUMN "reserveFundingQuoteUsdPerCkb",
  DROP COLUMN "reserveFundingQuoteSource",
  DROP COLUMN "reserveFundingQuotedAt",
  DROP COLUMN "reserveHealthStatus",
  DROP COLUMN "lastSettlementError",
  DROP COLUMN "ckbTxHashCreate",
  DROP COLUMN "ckbTxHashFund",
  DROP COLUMN "ckbTxHashRelease",
  DROP COLUMN "fiberPaymentReference";
ALTER TABLE public."Agreement" RENAME COLUMN "infrastructureReleaseMode" TO "releaseMode";
ALTER TABLE public."Agreement"
  ALTER COLUMN "releaseMode" SET DEFAULT 'milestone',
  ALTER COLUMN "releaseMode" SET NOT NULL,
  ALTER COLUMN "disputeMode" SET DEFAULT 'app_managed',
  ALTER COLUMN "disputeMode" SET NOT NULL;

ALTER TABLE public."Milestone"
  DROP COLUMN "targetUsd",
  DROP COLUMN "releaseQuoteUsdPerCkb",
  DROP COLUMN "releaseQuoteSource",
  DROP COLUMN "releaseQuotedAt",
  DROP COLUMN "releasedCkbAmount",
  DROP COLUMN "releasedUsdValue",
  DROP COLUMN "escrowFundingTxHash",
  DROP COLUMN "escrowOutputIndex",
  DROP COLUMN "escrowCellData",
  DROP COLUMN "refundTimeoutBlock";

DROP INDEX IF EXISTS public."Proof_milestoneId_reviewStatus_submittedAt_idx";
ALTER TABLE public."Proof"
  DROP COLUMN "reviewStatus",
  DROP COLUMN "lastCheckedAt";
CREATE INDEX "Proof_milestoneId_status_submittedAt_idx"
  ON public."Proof"("milestoneId", status, "submittedAt");

UPDATE public."Dispute"
SET "openedByExternalId" = COALESCE("openedByExternalId", "openedBy");
ALTER TABLE public."Dispute"
  DROP COLUMN "openedBy",
  DROP COLUMN "evidenceNotes",
  DROP COLUMN "aiSummary",
  DROP COLUMN "aiRecommendation",
  DROP COLUMN "aiConfidence",
  DROP COLUMN "aiRationale";

-- Preserve the existing funded-term protections against the cleaned model.
CREATE FUNCTION prevent_funded_agreement_term_changes()
RETURNS trigger AS $$
BEGIN
  IF (
    OLD."settlementStatus" <> 'UNFUNDED'
    OR OLD."fundingConfirmedAt" IS NOT NULL
    OR OLD.status IN ('FUNDED', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'DISPUTED', 'REFUNDED')
    OR OLD.status IN ('funded', 'in_progress', 'proof_submitted', 'under_review', 'approved', 'release_pending', 'released', 'disputed', 'refunded')
  ) AND (
    NEW.title IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW."clientExternalId" IS DISTINCT FROM OLD."clientExternalId"
    OR NEW."workerExternalId" IS DISTINCT FROM OLD."workerExternalId"
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW."deadlineAt" IS DISTINCT FROM OLD."deadlineAt"
    OR NEW."disputeWindowSecs" IS DISTINCT FROM OLD."disputeWindowSecs"
    OR NEW."releaseMode" IS DISTINCT FROM OLD."releaseMode"
    OR NEW."disputeMode" IS DISTINCT FROM OLD."disputeMode"
  ) THEN
    RAISE EXCEPTION 'Funded agreement terms are immutable.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Agreement_funded_terms_immutable"
BEFORE UPDATE ON public."Agreement"
FOR EACH ROW EXECUTE FUNCTION prevent_funded_agreement_term_changes();

CREATE FUNCTION prevent_funded_milestone_term_changes()
RETURNS trigger AS $$
DECLARE agreement_funded boolean;
BEGIN
  SELECT (
    agreement."settlementStatus" <> 'UNFUNDED'
    OR agreement."fundingConfirmedAt" IS NOT NULL
    OR agreement.status IN ('FUNDED', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'DISPUTED', 'REFUNDED')
    OR agreement.status IN ('funded', 'in_progress', 'proof_submitted', 'under_review', 'approved', 'release_pending', 'released', 'disputed', 'refunded')
  ) INTO agreement_funded
  FROM public."Agreement" agreement
  WHERE agreement.id = OLD."agreementId";

  IF agreement_funded AND (
    NEW.title IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW."sortOrder" IS DISTINCT FROM OLD."sortOrder"
    OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate"
  ) THEN
    RAISE EXCEPTION 'Funded milestone terms are immutable.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Milestone_funded_terms_immutable"
BEFORE UPDATE ON public."Milestone"
FOR EACH ROW EXECUTE FUNCTION prevent_funded_milestone_term_changes();

CREATE FUNCTION prevent_funded_milestone_membership_changes()
RETURNS trigger AS $$
DECLARE
  target_agreement_id text;
  agreement_funded boolean;
BEGIN
  target_agreement_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."agreementId" ELSE NEW."agreementId" END;
  SELECT (
    agreement."settlementStatus" <> 'UNFUNDED'
    OR agreement."fundingConfirmedAt" IS NOT NULL
    OR agreement.status IN ('FUNDED', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'DISPUTED', 'REFUNDED')
    OR agreement.status IN ('funded', 'in_progress', 'proof_submitted', 'under_review', 'approved', 'release_pending', 'released', 'disputed', 'refunded')
  ) INTO agreement_funded
  FROM public."Agreement" agreement
  WHERE agreement.id = target_agreement_id;

  IF agreement_funded THEN
    RAISE EXCEPTION 'Milestones cannot be added to or removed from a funded agreement.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Milestone_funded_membership_immutable"
BEFORE INSERT OR DELETE ON public."Milestone"
FOR EACH ROW EXECUTE FUNCTION prevent_funded_milestone_membership_changes();

REVOKE ALL ON ALL TABLES IN SCHEMA legacy_product_archive FROM PUBLIC;
