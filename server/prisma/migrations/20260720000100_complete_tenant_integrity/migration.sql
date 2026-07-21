-- Fail with an actionable summary before adding the remaining tenant constraints.
DO $$
DECLARE
  violations text;
BEGIN
  SELECT string_agg(check_name || '=' || violation_count, ', ' ORDER BY check_name)
  INTO violations
  FROM (
    SELECT 'Event.proofSubmissionId' AS check_name, count(*)::text AS violation_count
    FROM "Event" child
    JOIN "Proof" parent ON parent.id = child."proofSubmissionId"
    WHERE child."proofSubmissionId" IS NOT NULL AND child."appId" <> parent."appId"
    HAVING count(*) > 0
    UNION ALL
    SELECT 'Event.disputeId', count(*)::text
    FROM "Event" child
    JOIN "Dispute" parent ON parent.id = child."disputeId"
    WHERE child."disputeId" IS NOT NULL AND child."appId" <> parent."appId"
    HAVING count(*) > 0
  ) audit;

  IF violations IS NOT NULL THEN
    RAISE EXCEPTION 'Tenant-integrity migration blocked: %', violations;
  END IF;
END $$;

CREATE UNIQUE INDEX "WebhookDelivery_id_appId_key" ON "WebhookDelivery"("id", "appId");
CREATE UNIQUE INDEX "Transaction_id_appId_key" ON "Transaction"("id", "appId");
CREATE UNIQUE INDEX "Review_id_appId_key" ON "Review"("id", "appId");

-- Replace redundant single-column ownership foreign keys so the Prisma schema
-- and PostgreSQL express the same tenant-aware relationships.
ALTER TABLE "Milestone" DROP CONSTRAINT "Milestone_agreementId_fkey";
ALTER TABLE "Proof"
  DROP CONSTRAINT "Proof_agreementId_fkey",
  DROP CONSTRAINT "Proof_milestoneId_fkey";
ALTER TABLE "Escrow"
  DROP CONSTRAINT "Escrow_agreementId_fkey",
  DROP CONSTRAINT "Escrow_milestoneId_fkey";
ALTER TABLE "Transaction"
  DROP CONSTRAINT "Transaction_agreementId_fkey",
  DROP CONSTRAINT "Transaction_milestoneId_fkey",
  DROP CONSTRAINT "Transaction_escrowId_fkey";
ALTER TABLE "Review"
  DROP CONSTRAINT "Review_agreementId_fkey",
  DROP CONSTRAINT "Review_milestoneId_fkey",
  DROP CONSTRAINT "Review_proofSubmissionId_fkey";
ALTER TABLE "Dispute"
  DROP CONSTRAINT "Dispute_agreementId_fkey",
  DROP CONSTRAINT "Dispute_milestoneId_fkey";
ALTER TABLE "Event"
  DROP CONSTRAINT "Event_agreementId_fkey",
  DROP CONSTRAINT "Event_milestoneId_fkey",
  DROP CONSTRAINT "Event_escrowId_fkey";
ALTER TABLE "WebhookDelivery"
  DROP CONSTRAINT "WebhookDelivery_endpointId_fkey",
  DROP CONSTRAINT "WebhookDelivery_eventId_fkey",
  DROP CONSTRAINT "WebhookDelivery_agreementId_fkey";
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_agreementId_fkey";

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_proofSubmissionId_appId_fkey"
  FOREIGN KEY ("proofSubmissionId", "appId") REFERENCES "Proof"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Event_disputeId_appId_fkey"
  FOREIGN KEY ("disputeId", "appId") REFERENCES "Dispute"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
