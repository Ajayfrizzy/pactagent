-- Persist enough CKB intent and observation data to reconcile without an API
-- process's memory or an adapter response.
ALTER TABLE "Escrow"
  ADD COLUMN "lockOutputIndex" INTEGER,
  ADD COLUMN "lockScriptJson" TEXT,
  ADD COLUMN "clientLockScriptJson" TEXT,
  ADD COLUMN "workerLockScriptJson" TEXT,
  ADD COLUMN "cellData" TEXT,
  ADD COLUMN "contractVersion" INTEGER,
  ADD COLUMN "refundTimeoutSince" TEXT;

ALTER TABLE "Transaction"
  ADD COLUMN "operationId" TEXT,
  ADD COLUMN "blockHash" TEXT,
  ADD COLUMN "blockNumber" TEXT,
  ADD COLUMN confirmations INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastCheckedAt" TIMESTAMP(3),
  ADD COLUMN "broadcastAt" TIMESTAMP(3),
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "reconciliationError" TEXT;

CREATE UNIQUE INDEX "Transaction_appId_operationId_key"
  ON "Transaction"("appId", "operationId");
CREATE INDEX "Transaction_status_lastCheckedAt_createdAt_idx"
  ON "Transaction"(status, "lastCheckedAt", "createdAt");

ALTER TABLE "Escrow" DROP CONSTRAINT "Escrow_status_lifecycle_check";
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_status_lifecycle_check"
  CHECK (status IN (
    'not_created','awaiting_funding','funding_detected','funded','release_pending',
    'released','refund_pending','refunded','reconciliation_required','failed'
  ));

ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_status_lifecycle_check";
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_status_lifecycle_check"
  CHECK (status IN (
    'pending','broadcast','committed','confirmed','reconciliation_required',
    'rejected','reorged','failed'
  ));

DROP INDEX "Escrow_one_active_agreement_scope_key";
DROP INDEX "Escrow_one_active_milestone_scope_key";
CREATE UNIQUE INDEX "Escrow_one_active_agreement_scope_key"
  ON "Escrow"("appId", "agreementId")
  WHERE "milestoneId" IS NULL
    AND status IN (
      'not_created','awaiting_funding','funding_detected','funded',
      'release_pending','refund_pending','reconciliation_required','failed'
    );
CREATE UNIQUE INDEX "Escrow_one_active_milestone_scope_key"
  ON "Escrow"("appId", "agreementId", "milestoneId")
  WHERE "milestoneId" IS NOT NULL
    AND status IN (
      'not_created','awaiting_funding','funding_detected','funded',
      'release_pending','refund_pending','reconciliation_required','failed'
    );

ALTER TABLE "AgentJob" DROP CONSTRAINT "AgentJob_queue_check";
ALTER TABLE "AgentJob" DROP CONSTRAINT "AgentJob_kind_check";
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_queue_check"
  CHECK (queue IN ('webhook','settlement'));
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_kind_check"
  CHECK (kind IN ('DELIVER_WEBHOOK','CKB_RECONCILE_TRANSACTION'));

DO $$
DECLARE
  invalid_ckb_rows integer;
BEGIN
  SELECT count(*) INTO invalid_ckb_rows
  FROM "Escrow"
  WHERE rail = 'ckb'
    AND status <> 'not_created';

  IF invalid_ckb_rows > 0 THEN
    RAISE EXCEPTION 'CKB reconciliation migration blocked: % existing non-draft CKB escrows lack reconstructable contract commitments.', invalid_ckb_rows;
  END IF;
END $$;

ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_ckb_commitment_check"
  CHECK (
    rail <> 'ckb'
    OR status = 'not_created'
    OR (
      currency = 'CKB'
      AND "lockTxHash" ~ '^0x[0-9a-fA-F]{64}$'
      AND "lockScriptJson" IS NOT NULL
      AND "clientLockScriptJson" IS NOT NULL
      AND "workerLockScriptJson" IS NOT NULL
      AND "cellData" ~ '^0x[0-9a-fA-F]{176}$'
      AND "contractVersion" = 1
      AND "refundTimeoutSince" ~ '^[0-9]+$'
      AND "refundTimeoutSince"::numeric <= 72057594037927935
      AND "lockOutputIndex" >= 0
    )
  );

ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_ckb_scope_check"
  CHECK (rail <> 'ckb' OR ("milestoneId" IS NOT NULL AND currency = 'CKB'));
