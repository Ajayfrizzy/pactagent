ALTER TABLE "AgentJob"
  ADD COLUMN "queue" TEXT NOT NULL DEFAULT 'settlement',
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

UPDATE "AgentJob" SET queue = CASE
  WHEN kind = 'DELIVER_WEBHOOK' THEN 'webhook'
  WHEN kind = 'DISPUTE_RECOMMENDATION' THEN 'ai'
  ELSE 'settlement'
END;

UPDATE "AgentJob"
SET "leaseExpiresAt" = COALESCE("lockedAt", now()) + interval '5 minutes'
WHERE status = 'RUNNING' AND "leaseExpiresAt" IS NULL;

DROP INDEX IF EXISTS "AgentJob_status_availableAt_createdAt_idx";
CREATE INDEX "AgentJob_queue_status_availableAt_leaseExpiresAt_createdAt_idx"
  ON "AgentJob"(queue, status, "availableAt", "leaseExpiresAt", "createdAt");

ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_queue_check"
  CHECK (queue IN ('settlement','webhook','ai'));
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_lease_consistency_check"
  CHECK (
    (status = 'RUNNING' AND "lockedAt" IS NOT NULL AND "lockedBy" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR (status <> 'RUNNING' AND "lockedAt" IS NULL AND "lockedBy" IS NULL AND "leaseExpiresAt" IS NULL)
  ) NOT VALID;

ALTER TABLE "MilestoneSettlement" ADD COLUMN "operationKey" TEXT;
CREATE UNIQUE INDEX "MilestoneSettlement_operationKey_key" ON "MilestoneSettlement"("operationKey");
