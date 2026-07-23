ALTER TABLE "Milestone"
  ADD COLUMN "reviewStartedAt" TIMESTAMP(3),
  ADD COLUMN "reviewDeadlineAt" TIMESTAMP(3);

CREATE INDEX "Milestone_status_reviewDeadlineAt_idx"
  ON "Milestone"("status", "reviewDeadlineAt");

CREATE OR REPLACE FUNCTION prevent_funded_agreement_term_changes()
RETURNS trigger AS $$
BEGIN
  IF (
    OLD."settlementStatus" <> 'UNFUNDED'
    OR OLD."ckbTxHashFund" IS NOT NULL
    OR OLD."fundingConfirmedAt" IS NOT NULL
    OR OLD.status IN ('FUNDED', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'DISPUTED', 'REFUNDED')
    OR OLD.status IN ('funded', 'in_progress', 'proof_submitted', 'under_review', 'approved', 'release_pending', 'released', 'disputed', 'refunded')
  ) AND (
    NEW.title IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW."clientAddress" IS DISTINCT FROM OLD."clientAddress"
    OR NEW."workerAddress" IS DISTINCT FROM OLD."workerAddress"
    OR NEW."arbitratorAddress" IS DISTINCT FROM OLD."arbitratorAddress"
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW."deadlineAt" IS DISTINCT FROM OLD."deadlineAt"
    OR NEW."disputeWindowSecs" IS DISTINCT FROM OLD."disputeWindowSecs"
    OR NEW."proofType" IS DISTINCT FROM OLD."proofType"
    OR NEW."reviewerMode" IS DISTINCT FROM OLD."reviewerMode"
    OR NEW."releaseMode" IS DISTINCT FROM OLD."releaseMode"
    OR NEW."payoutNetwork" IS DISTINCT FROM OLD."payoutNetwork"
    OR NEW."escrowModel" IS DISTINCT FROM OLD."escrowModel"
    OR NEW."pricingMode" IS DISTINCT FROM OLD."pricingMode"
    OR NEW."agreementDigest" IS DISTINCT FROM OLD."agreementDigest"
    OR NEW."milestoneDigest" IS DISTINCT FROM OLD."milestoneDigest"
  ) THEN
    RAISE EXCEPTION 'Funded agreement terms are immutable.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Agreement_funded_terms_immutable"
BEFORE UPDATE ON "Agreement"
FOR EACH ROW EXECUTE FUNCTION prevent_funded_agreement_term_changes();

CREATE OR REPLACE FUNCTION prevent_funded_milestone_term_changes()
RETURNS trigger AS $$
DECLARE
  agreement_funded boolean;
BEGIN
  SELECT (
    agreement."settlementStatus" <> 'UNFUNDED'
    OR agreement."ckbTxHashFund" IS NOT NULL
    OR agreement."fundingConfirmedAt" IS NOT NULL
    OR agreement.status IN ('FUNDED', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'DISPUTED', 'REFUNDED')
    OR agreement.status IN ('funded', 'in_progress', 'proof_submitted', 'under_review', 'approved', 'release_pending', 'released', 'disputed', 'refunded')
  ) INTO agreement_funded
  FROM "Agreement" agreement
  WHERE agreement.id = OLD."agreementId";

  IF agreement_funded AND (
    NEW.title IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW."targetUsd" IS DISTINCT FROM OLD."targetUsd"
    OR NEW."sortOrder" IS DISTINCT FROM OLD."sortOrder"
    OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate"
  ) THEN
    RAISE EXCEPTION 'Funded milestone terms are immutable.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Milestone_funded_terms_immutable"
BEFORE UPDATE ON "Milestone"
FOR EACH ROW EXECUTE FUNCTION prevent_funded_milestone_term_changes();

CREATE OR REPLACE FUNCTION prevent_funded_milestone_membership_changes()
RETURNS trigger AS $$
DECLARE
  target_agreement_id text;
  agreement_funded boolean;
BEGIN
  target_agreement_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."agreementId" ELSE NEW."agreementId" END;

  SELECT (
    agreement."settlementStatus" <> 'UNFUNDED'
    OR agreement."ckbTxHashFund" IS NOT NULL
    OR agreement."fundingConfirmedAt" IS NOT NULL
    OR agreement.status IN ('FUNDED', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'DISPUTED', 'REFUNDED')
    OR agreement.status IN ('funded', 'in_progress', 'proof_submitted', 'under_review', 'approved', 'release_pending', 'released', 'disputed', 'refunded')
  ) INTO agreement_funded
  FROM "Agreement" agreement
  WHERE agreement.id = target_agreement_id;

  IF agreement_funded THEN
    RAISE EXCEPTION 'Milestones cannot be added to or removed from a funded agreement.' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Milestone_funded_membership_immutable"
BEFORE INSERT OR DELETE ON "Milestone"
FOR EACH ROW EXECUTE FUNCTION prevent_funded_milestone_membership_changes();
