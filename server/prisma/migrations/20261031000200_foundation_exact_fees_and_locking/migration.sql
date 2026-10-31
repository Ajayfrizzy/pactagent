-- Forward correction of merged M1 SQL. Preserve the original migration checksum.
-- No financial value, legacy commitment or funded record is rewritten.
BEGIN;
ALTER TABLE "EscrowFoundation"
  DROP CONSTRAINT "EscrowFoundation_check",
  ADD CONSTRAINT "EscrowFoundation_exact_client_fee_check"
    CHECK ("clientFeeDeposit"::numeric = div(principal::numeric * "clientFeeBps", 10000));

-- Fail closed if the old race produced inconsistent metadata. Never guess a repair.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "EscrowFoundation" f JOIN "Escrow" e ON e.id = f."escrowId" AND e."appId" = f."appId"
    WHERE f."agreementId" IS DISTINCT FROM e."agreementId"
       OR f."milestoneId" IS DISTINCT FROM e."milestoneId"
       OR (f."assetId" = 'asset:v1:ckb:aggron4/native:ckb' AND (e.rail <> 'ckb' OR e.network <> 'testnet'))
       OR (f."assetId" = 'asset:v1:sandbox:local/synthetic:units' AND (e.rail NOT IN ('mock','manual') OR e.network <> 'sandbox'))
  ) THEN
    RAISE EXCEPTION 'M1 foundation scope mismatch: reviewed repair required before migration' USING ERRCODE = 'check_violation';
  END IF;
END $$;

-- FOR UPDATE conflicts with non-key parent updates as well as other inserts.
CREATE OR REPLACE FUNCTION m1_foundation_scope() RETURNS trigger AS $$
DECLARE parent "Escrow"%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM "Escrow" WHERE id = NEW."escrowId" AND "appId" = NEW."appId" FOR UPDATE;
  IF NOT FOUND OR parent."agreementId" IS DISTINCT FROM NEW."agreementId" OR parent."milestoneId" IS DISTINCT FROM NEW."milestoneId" THEN
    RAISE EXCEPTION 'Foundation parent scope mismatch' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."assetId" = 'asset:v1:ckb:aggron4/native:ckb' AND (parent.rail <> 'ckb' OR parent.network <> 'testnet')) OR
     (NEW."assetId" = 'asset:v1:sandbox:local/synthetic:units' AND (parent.rail NOT IN ('mock','manual') OR parent.network <> 'sandbox')) THEN
    RAISE EXCEPTION 'Foundation asset rail mismatch' USING ERRCODE = 'check_violation';
  END IF;
  -- This stores prospective application terms, NEVER a funded-v1 retrofit.
  IF parent.status NOT IN ('not_created', 'awaiting_funding') THEN
    RAISE EXCEPTION 'Cannot attach prospective terms to funded legacy escrow' USING ERRCODE = 'check_violation';
  END IF;
  -- Advance only the MVCC row version, without changing any escrow value.
  -- A parent writer using an older REPEATABLE READ snapshot must serialize-fail,
  -- not miss this new foundation after waiting for our row lock.
  UPDATE "Escrow" SET id = id WHERE id = parent.id AND "appId" = parent."appId";
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
COMMIT;
