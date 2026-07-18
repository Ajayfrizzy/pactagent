-- Infrastructure records carry appId directly for efficient tenant-scoped queries.
-- These composite foreign keys make that duplicated ownership information authoritative:
-- a child cannot point at a resource owned by another app.

-- New databases receive these indexes from the baseline. Existing databases
-- adopted from `prisma db push` receive them here before the foreign keys.
CREATE UNIQUE INDEX IF NOT EXISTS "Agreement_id_appId_key" ON "Agreement"("id", "appId");
CREATE UNIQUE INDEX IF NOT EXISTS "Dispute_id_appId_key" ON "Dispute"("id", "appId");
CREATE UNIQUE INDEX IF NOT EXISTS "Event_id_appId_key" ON "Event"("id", "appId");
CREATE UNIQUE INDEX IF NOT EXISTS "Milestone_id_appId_key" ON "Milestone"("id", "appId");
CREATE UNIQUE INDEX IF NOT EXISTS "Proof_id_appId_key" ON "Proof"("id", "appId");
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEndpoint_id_appId_key" ON "WebhookEndpoint"("id", "appId");

ALTER TABLE "Milestone"
  ADD CONSTRAINT "Milestone_agreementId_appId_fkey"
  FOREIGN KEY ("agreementId", "appId") REFERENCES "Agreement"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Proof"
  ADD CONSTRAINT "Proof_agreementId_appId_fkey"
  FOREIGN KEY ("agreementId", "appId") REFERENCES "Agreement"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Proof_milestoneId_appId_fkey"
  FOREIGN KEY ("milestoneId", "appId") REFERENCES "Milestone"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Escrow"
  ADD CONSTRAINT "Escrow_agreementId_appId_fkey"
  FOREIGN KEY ("agreementId", "appId") REFERENCES "Agreement"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Escrow_milestoneId_appId_fkey"
  FOREIGN KEY ("milestoneId", "appId") REFERENCES "Milestone"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_agreementId_appId_fkey"
  FOREIGN KEY ("agreementId", "appId") REFERENCES "Agreement"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Transaction_milestoneId_appId_fkey"
  FOREIGN KEY ("milestoneId", "appId") REFERENCES "Milestone"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Transaction_escrowId_appId_fkey"
  FOREIGN KEY ("escrowId", "appId") REFERENCES "Escrow"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Review"
  ADD CONSTRAINT "Review_agreementId_appId_fkey"
  FOREIGN KEY ("agreementId", "appId") REFERENCES "Agreement"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Review_milestoneId_appId_fkey"
  FOREIGN KEY ("milestoneId", "appId") REFERENCES "Milestone"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Review_proofSubmissionId_appId_fkey"
  FOREIGN KEY ("proofSubmissionId", "appId") REFERENCES "Proof"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Dispute"
  ADD CONSTRAINT "Dispute_agreementId_appId_fkey"
  FOREIGN KEY ("agreementId", "appId") REFERENCES "Agreement"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Dispute_milestoneId_appId_fkey"
  FOREIGN KEY ("milestoneId", "appId") REFERENCES "Milestone"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_agreementId_appId_fkey"
  FOREIGN KEY ("agreementId", "appId") REFERENCES "Agreement"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Event_milestoneId_appId_fkey"
  FOREIGN KEY ("milestoneId", "appId") REFERENCES "Milestone"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Event_escrowId_appId_fkey"
  FOREIGN KEY ("escrowId", "appId") REFERENCES "Escrow"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_endpointId_appId_fkey"
  FOREIGN KEY ("endpointId", "appId") REFERENCES "WebhookEndpoint"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WebhookDelivery_eventId_appId_fkey"
  FOREIGN KEY ("eventId", "appId") REFERENCES "Event"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WebhookDelivery_agreementId_appId_fkey"
  FOREIGN KEY ("agreementId", "appId") REFERENCES "Agreement"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_agreementId_appId_fkey"
  FOREIGN KEY ("agreementId", "appId") REFERENCES "Agreement"("id", "appId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
