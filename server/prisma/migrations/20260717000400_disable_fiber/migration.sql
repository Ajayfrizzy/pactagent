-- Fiber is no longer an active payout rail. Preserve completed historical records,
-- but move every non-terminal agreement and pending amendment to CKB.
UPDATE "Agreement"
SET "payoutNetwork" = 'CKB', "workerFiberPubkey" = NULL
WHERE "payoutNetwork" = 'FIBER'
  AND UPPER("status") NOT IN ('COMPLETED', 'RELEASED', 'REFUNDED', 'CANCELLED', 'EXPIRED');

UPDATE "AgreementAmendment"
SET "payoutNetwork" = 'CKB', "workerFiberPubkey" = NULL
WHERE "status" = 'PROPOSED' AND "payoutNetwork" = 'FIBER';

UPDATE "PublicProfile" SET "fiberPubkey" = NULL WHERE "fiberPubkey" IS NOT NULL;
