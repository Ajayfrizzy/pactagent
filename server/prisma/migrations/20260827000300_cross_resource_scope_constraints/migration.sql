-- Prevent same-tenant references that combine resources from different
-- agreements or milestones. The existing app-scoped foreign keys remain in
-- place; these constraints add the missing cross-resource relationship.
UPDATE "Review" review
SET "milestoneId" = proof."milestoneId"
FROM "Proof" proof
WHERE review."milestoneId" IS NULL
  AND proof.id = review."proofSubmissionId"
  AND proof."agreementId" = review."agreementId"
  AND proof."appId" = review."appId";

DO $$
DECLARE
  violations text;
BEGIN
  SELECT string_agg(check_name || '=' || violation_count, ', ' ORDER BY check_name)
  INTO violations
  FROM (
    SELECT 'Proof milestone/agreement' AS check_name, count(*)::text AS violation_count
    FROM "Proof" proof
    LEFT JOIN "Milestone" milestone
      ON milestone.id = proof."milestoneId"
      AND milestone."agreementId" = proof."agreementId"
      AND milestone."appId" = proof."appId"
    WHERE milestone.id IS NULL HAVING count(*) > 0
    UNION ALL
    SELECT 'Review proof scope', count(*)::text
    FROM "Review" review
    LEFT JOIN "Proof" proof
      ON proof.id = review."proofSubmissionId"
      AND proof."agreementId" = review."agreementId"
      AND proof."milestoneId" IS NOT DISTINCT FROM review."milestoneId"
      AND proof."appId" = review."appId"
    WHERE proof.id IS NULL HAVING count(*) > 0
    UNION ALL
    SELECT 'Dispute milestone/agreement', count(*)::text
    FROM "Dispute" dispute
    LEFT JOIN "Milestone" milestone
      ON milestone.id = dispute."milestoneId"
      AND milestone."agreementId" = dispute."agreementId"
      AND milestone."appId" = dispute."appId"
    WHERE milestone.id IS NULL HAVING count(*) > 0
    UNION ALL
    SELECT 'Escrow milestone/agreement', count(*)::text
    FROM "Escrow" escrow
    LEFT JOIN "Milestone" milestone
      ON milestone.id = escrow."milestoneId"
      AND milestone."agreementId" = escrow."agreementId"
      AND milestone."appId" = escrow."appId"
    WHERE escrow."milestoneId" IS NOT NULL AND milestone.id IS NULL HAVING count(*) > 0
    UNION ALL
    SELECT 'Transaction milestone/agreement', count(*)::text
    FROM "Transaction" transaction
    LEFT JOIN "Milestone" milestone
      ON milestone.id = transaction."milestoneId"
      AND milestone."agreementId" = transaction."agreementId"
      AND milestone."appId" = transaction."appId"
    WHERE transaction."milestoneId" IS NOT NULL AND milestone.id IS NULL HAVING count(*) > 0
    UNION ALL
    SELECT 'Transaction escrow scope', count(*)::text
    FROM "Transaction" transaction
    JOIN "Escrow" escrow
      ON escrow.id = transaction."escrowId" AND escrow."appId" = transaction."appId"
    WHERE transaction."agreementId" IS DISTINCT FROM escrow."agreementId"
       OR transaction."milestoneId" IS DISTINCT FROM escrow."milestoneId"
       OR transaction.rail IS DISTINCT FROM escrow.rail
       OR transaction.network IS DISTINCT FROM escrow.network
       OR transaction.amount IS DISTINCT FROM escrow.amount
       OR transaction.currency IS DISTINCT FROM escrow.currency
    HAVING count(*) > 0
  ) invalid_relationships;

  IF violations IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 2 cross-resource migration blocked: %', violations;
  END IF;
END $$;

ALTER TABLE "Review" ALTER COLUMN "milestoneId" SET NOT NULL;

CREATE UNIQUE INDEX "Milestone_id_agreementId_appId_key"
  ON "Milestone"(id, "agreementId", "appId");
CREATE UNIQUE INDEX "Proof_id_agreementId_milestoneId_appId_key"
  ON "Proof"(id, "agreementId", "milestoneId", "appId");

ALTER TABLE "Proof" ADD CONSTRAINT "Proof_milestone_agreement_scope_fkey"
  FOREIGN KEY ("milestoneId", "agreementId", "appId")
  REFERENCES "Milestone"(id, "agreementId", "appId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Review" ADD CONSTRAINT "Review_proof_scope_fkey"
  FOREIGN KEY ("proofSubmissionId", "agreementId", "milestoneId", "appId")
  REFERENCES "Proof"(id, "agreementId", "milestoneId", "appId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_milestone_agreement_scope_fkey"
  FOREIGN KEY ("milestoneId", "agreementId", "appId")
  REFERENCES "Milestone"(id, "agreementId", "appId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_milestone_agreement_scope_fkey"
  FOREIGN KEY ("milestoneId", "agreementId", "appId")
  REFERENCES "Milestone"(id, "agreementId", "appId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_milestone_agreement_scope_fkey"
  FOREIGN KEY ("milestoneId", "agreementId", "appId")
  REFERENCES "Milestone"(id, "agreementId", "appId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION enforce_transaction_escrow_scope()
RETURNS trigger AS $$
DECLARE
  expected "Escrow"%ROWTYPE;
BEGIN
  IF NEW."escrowId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO expected
  FROM "Escrow"
  WHERE id = NEW."escrowId" AND "appId" = NEW."appId";

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF NEW."agreementId" IS DISTINCT FROM expected."agreementId"
     OR NEW."milestoneId" IS DISTINCT FROM expected."milestoneId"
     OR NEW.rail IS DISTINCT FROM expected.rail
     OR NEW.network IS DISTINCT FROM expected.network
     OR NEW.amount IS DISTINCT FROM expected.amount
     OR NEW.currency IS DISTINCT FROM expected.currency THEN
    RAISE EXCEPTION 'Transaction fields must match the referenced escrow scope.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Transaction_escrow_scope_invariant"
BEFORE INSERT OR UPDATE OF "escrowId", "agreementId", "milestoneId", "appId", rail, network, amount, currency
ON "Transaction"
FOR EACH ROW EXECUTE FUNCTION enforce_transaction_escrow_scope();
