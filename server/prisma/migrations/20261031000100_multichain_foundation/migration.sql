-- Additive only. No inference/backfill of legacy assets, consent or deployments.
BEGIN;
CREATE TABLE "EscrowFoundation" (
  id TEXT PRIMARY KEY, "appId" TEXT NOT NULL, "escrowId" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL, "milestoneId" TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK (version = 1),
  "assetId" TEXT NOT NULL, network TEXT NOT NULL, "deploymentId" TEXT NOT NULL,
  "termsHash" TEXT NOT NULL CHECK ("termsHash" ~ '^[0-9a-f]{64}$'), "canonicalTerms" TEXT NOT NULL,
  principal TEXT NOT NULL CHECK (principal ~ '^[1-9][0-9]{0,77}$'),
  "clientFeeDeposit" TEXT NOT NULL CHECK ("clientFeeDeposit" ~ '^(0|[1-9][0-9]{0,77})$'),
  "clientFeeBps" INTEGER NOT NULL CHECK ("clientFeeBps" BETWEEN 0 AND 1000),
  "workerFeeBps" INTEGER NOT NULL CHECK ("workerFeeBps" BETWEEN 0 AND 1000),
  "maxBaseUnits" TEXT NOT NULL CHECK ("maxBaseUnits" ~ '^[1-9][0-9]{0,77}$'),
  "finalityPolicyVersion" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EscrowFoundation_id_appId_key" UNIQUE(id, "appId"),
  CONSTRAINT "EscrowFoundation_escrowId_appId_key" UNIQUE("escrowId", "appId"),
  FOREIGN KEY ("escrowId", "appId") REFERENCES "Escrow"(id, "appId") ON DELETE RESTRICT,
  FOREIGN KEY ("agreementId", "appId") REFERENCES "Agreement"(id, "appId") ON DELETE RESTRICT,
  FOREIGN KEY ("milestoneId", "agreementId", "appId") REFERENCES "Milestone"(id, "agreementId", "appId") ON DELETE RESTRICT,
  CHECK ("clientFeeDeposit"::numeric = floor(principal::numeric * "clientFeeBps" / 10000)),
  CHECK (principal::numeric + "clientFeeDeposit"::numeric <= "maxBaseUnits"::numeric),
  CHECK (("assetId" = 'asset:v1:ckb:aggron4/native:ckb' AND network = 'ckb:aggron4' AND "maxBaseUnits" = '18446744073709551615') OR
         ("assetId" = 'asset:v1:sandbox:local/synthetic:units' AND network = 'sandbox:local' AND "maxBaseUnits" = '115792089237316195423570985008687907853269984665640564039457584007913129639935'))
);
CREATE FUNCTION m1_foundation_scope() RETURNS trigger AS $$
DECLARE parent "Escrow"%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM "Escrow" WHERE id = NEW."escrowId" AND "appId" = NEW."appId" FOR KEY SHARE;
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
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "EscrowFoundation_scope" BEFORE INSERT ON "EscrowFoundation" FOR EACH ROW EXECUTE FUNCTION m1_foundation_scope();
CREATE TABLE "SettlementOperation" (
  id TEXT PRIMARY KEY, "appId" TEXT NOT NULL, "foundationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  "intentHash" TEXT NOT NULL CHECK ("intentHash" ~ '^[0-9a-f]{64}$'), "canonicalIntent" TEXT NOT NULL,
  nonce TEXT NOT NULL DEFAULT '0' CHECK (nonce = '0'),
  "principalWorker" TEXT NOT NULL CHECK ("principalWorker" ~ '^(0|[1-9][0-9]{0,77})$'),
  "principalClient" TEXT NOT NULL CHECK ("principalClient" ~ '^(0|[1-9][0-9]{0,77})$'),
  -- M1 stores proposals only. A later reviewed verifier migration enables execution.
  state TEXT NOT NULL DEFAULT 'unauthorized' CHECK (state = 'unauthorized'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementOperation_id_appId_key" UNIQUE(id, "appId"),
  CONSTRAINT "SettlementOperation_appId_idempotencyKey_key" UNIQUE("appId", "idempotencyKey"),
  CONSTRAINT "SettlementOperation_foundationId_nonce_key" UNIQUE("foundationId", nonce),
  FOREIGN KEY ("foundationId", "appId") REFERENCES "EscrowFoundation"(id, "appId") ON DELETE RESTRICT
);
CREATE FUNCTION m1_allocation_scope() RETURNS trigger AS $$
DECLARE p TEXT;
BEGIN
 SELECT principal INTO p FROM "EscrowFoundation" WHERE id = NEW."foundationId" AND "appId" = NEW."appId";
 IF p IS NULL OR NEW."principalWorker"::numeric + NEW."principalClient"::numeric <> p::numeric THEN
   RAISE EXCEPTION 'Operation allocation must conserve scoped principal' USING ERRCODE = 'check_violation';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "SettlementOperation_allocation" BEFORE INSERT ON "SettlementOperation" FOR EACH ROW EXECUTE FUNCTION m1_allocation_scope();
CREATE TABLE "BroadcastAttempt" (
 id TEXT PRIMARY KEY, "appId" TEXT NOT NULL, "operationId" TEXT NOT NULL, attempt INTEGER NOT NULL CHECK (attempt > 0),
 "transactionId" TEXT NOT NULL CHECK (length("transactionId") > 0),
 "artifactHash" TEXT NOT NULL CHECK ("artifactHash" ~ '^[0-9a-f]{64}$'),
 "artifactReference" TEXT NOT NULL CHECK (length("artifactReference") > 0),
 "authorizationProofHash" TEXT NOT NULL CHECK ("authorizationProofHash" ~ '^[0-9a-f]{64}$'),
 outcome TEXT NOT NULL CHECK (outcome IN ('prepared','accepted','unknown','rejected')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BroadcastAttempt_id_appId_key" UNIQUE(id, "appId"),
 CONSTRAINT "BroadcastAttempt_operationId_attempt_key" UNIQUE("operationId", attempt),
 FOREIGN KEY ("operationId", "appId") REFERENCES "SettlementOperation"(id, "appId") ON DELETE RESTRICT
);
CREATE TABLE "ChainObservation" (
 id TEXT PRIMARY KEY, "appId" TEXT NOT NULL, "operationId" TEXT NOT NULL, "attemptId" TEXT NOT NULL,
 "policyVersion" TEXT NOT NULL, "transactionId" TEXT NOT NULL, "blockHash" TEXT, "blockNumber" TEXT, "logIndex" TEXT,
 canonical TEXT NOT NULL CHECK (canonical IN ('verified','unknown','removed','disagreeing')),
 "evidenceJson" TEXT NOT NULL, "correctionOf" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ChainObservation_id_appId_key" UNIQUE(id, "appId"),
 FOREIGN KEY ("operationId", "appId") REFERENCES "SettlementOperation"(id, "appId") ON DELETE RESTRICT,
 FOREIGN KEY ("attemptId", "appId") REFERENCES "BroadcastAttempt"(id, "appId") ON DELETE RESTRICT,
 FOREIGN KEY ("correctionOf", "appId") REFERENCES "ChainObservation"(id, "appId") ON DELETE RESTRICT,
 CHECK ("blockNumber" IS NULL OR "blockNumber" ~ '^(0|[1-9][0-9]{0,77})$'),
 CHECK ("logIndex" IS NULL OR "logIndex" ~ '^(0|[1-9][0-9]{0,77})$'),
 CHECK (canonical <> 'verified' OR ("blockHash" IS NOT NULL AND "blockNumber" IS NOT NULL))
);
CREATE INDEX "ChainObservation_appId_operationId_createdAt_idx" ON "ChainObservation"("appId", "operationId", "createdAt");
CREATE FUNCTION m1_observation_scope() RETURNS trigger AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "BroadcastAttempt" WHERE id = NEW."attemptId" AND "appId" = NEW."appId" AND "operationId" = NEW."operationId" AND "transactionId" = NEW."transactionId") THEN
  RAISE EXCEPTION 'Observation attempt scope mismatch' USING ERRCODE = 'check_violation';
 END IF;
 IF NEW."correctionOf" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ChainObservation" WHERE id = NEW."correctionOf" AND "appId" = NEW."appId" AND "operationId" = NEW."operationId") THEN
  RAISE EXCEPTION 'Correction scope mismatch' USING ERRCODE = 'check_violation';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "ChainObservation_scope" BEFORE INSERT ON "ChainObservation" FOR EACH ROW EXECUTE FUNCTION m1_observation_scope();
CREATE FUNCTION m1_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'M1 commitments and evidence are append-only' USING ERRCODE = 'check_violation'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "EscrowFoundation_immutable" BEFORE UPDATE OR DELETE ON "EscrowFoundation" FOR EACH ROW EXECUTE FUNCTION m1_immutable();
CREATE TRIGGER "SettlementOperation_immutable" BEFORE UPDATE OR DELETE ON "SettlementOperation" FOR EACH ROW EXECUTE FUNCTION m1_immutable();
CREATE TRIGGER "BroadcastAttempt_immutable" BEFORE UPDATE OR DELETE ON "BroadcastAttempt" FOR EACH ROW EXECUTE FUNCTION m1_immutable();
CREATE TRIGGER "ChainObservation_immutable" BEFORE UPDATE OR DELETE ON "ChainObservation" FOR EACH ROW EXECUTE FUNCTION m1_immutable();
-- Protect complete parent scope if an unfunded legacy row is later edited.
CREATE FUNCTION m1_preserve_parent_scope() RETURNS trigger AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "EscrowFoundation" WHERE "escrowId"=OLD.id AND "appId"=OLD."appId") AND
    (NEW.id,NEW."appId",NEW."agreementId",NEW."milestoneId",NEW.rail,NEW.network) IS DISTINCT FROM
    (OLD.id,OLD."appId",OLD."agreementId",OLD."milestoneId",OLD.rail,OLD.network) THEN
   RAISE EXCEPTION 'Foundation parent scope is immutable' USING ERRCODE = 'check_violation';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "Escrow_m1_scope" BEFORE UPDATE ON "Escrow" FOR EACH ROW EXECUTE FUNCTION m1_preserve_parent_scope();
COMMIT;
