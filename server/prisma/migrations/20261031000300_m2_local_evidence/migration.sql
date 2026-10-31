-- Additive LOCAL-ONLY evidence aggregate. No legacy rows or M1 constraints change.
CREATE TABLE "BaseLocalEscrow" (
  "id" TEXT PRIMARY KEY,
  "appId" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "milestoneId" TEXT NOT NULL,
  "termsHash" TEXT NOT NULL CHECK ("termsHash" ~ '^0x[0-9a-f]{64}$'),
  "canonicalTerms" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL DEFAULT 31337 CHECK ("chainId" = 31337),
  "instance" TEXT NOT NULL CHECK ("instance" ~ '^0x[0-9a-f]{40}$'),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "appId"),
  UNIQUE ("appId", "milestoneId"),
  UNIQUE ("chainId", "instance"),
  FOREIGN KEY ("agreementId", "appId") REFERENCES "Agreement" ("id", "appId") ON DELETE RESTRICT,
  FOREIGN KEY ("milestoneId", "agreementId", "appId") REFERENCES "Milestone" ("id", "agreementId", "appId") ON DELETE RESTRICT
);
CREATE TABLE "BaseLocalOperation" (
  "id" TEXT PRIMARY KEY,
  "appId" TEXT NOT NULL,
  "escrowId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL CHECK (length("idempotencyKey") BETWEEN 1 AND 200),
  "slot" TEXT NOT NULL CHECK ("slot" IN ('funding', 'dispute', 'terminal')),
  "action" TEXT NOT NULL CHECK ("action" IN ('funding', 'dispute', 'mutual', 'arbitration', 'fallback')),
  "requestHash" TEXT NOT NULL CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  "artifactHash" TEXT NOT NULL CHECK ("artifactHash" ~ '^[0-9a-f]{64}$'),
  "transactionId" TEXT NOT NULL CHECK ("transactionId" ~ '^0x[0-9a-f]{64}$'),
  "encryptedArtifact" TEXT NOT NULL,
  "keyVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "appId"),
  UNIQUE ("appId", "idempotencyKey"),
  UNIQUE ("escrowId", "slot"),
  CHECK (("action" IN ('mutual','arbitration','fallback') AND "slot"='terminal') OR "action"="slot"),
  FOREIGN KEY ("escrowId", "appId") REFERENCES "BaseLocalEscrow" ("id", "appId") ON DELETE RESTRICT
);
-- The operation row is the durable pending-work record. Attempts may only be
-- inserted after its artifact transaction commits; no network worker is enabled.
CREATE TABLE "BaseLocalEvidence" (
  "id" TEXT PRIMARY KEY,
  "appId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "state" TEXT NOT NULL CHECK ("state" IN ('prepared','unknown','included','finalized','reconciliation_required')),
  "evidenceJson" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("operationId", "sequence"),
  FOREIGN KEY ("operationId", "appId") REFERENCES "BaseLocalOperation" ("id", "appId") ON DELETE RESTRICT
);
CREATE INDEX "BaseLocalOperation_appId_createdAt_idx" ON "BaseLocalOperation" ("appId", "createdAt");
CREATE INDEX "BaseLocalEvidence_appId_operationId_idx" ON "BaseLocalEvidence" ("appId", "operationId");
CREATE FUNCTION "m2_local_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'M2 local evidence is immutable' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER "BaseLocalEscrow_immutable" BEFORE UPDATE OR DELETE ON "BaseLocalEscrow" FOR EACH ROW EXECUTE FUNCTION "m2_local_immutable"();
CREATE TRIGGER "BaseLocalOperation_immutable" BEFORE UPDATE OR DELETE ON "BaseLocalOperation" FOR EACH ROW EXECUTE FUNCTION "m2_local_immutable"();
CREATE TRIGGER "BaseLocalEvidence_immutable" BEFORE UPDATE OR DELETE ON "BaseLocalEvidence" FOR EACH ROW EXECUTE FUNCTION "m2_local_immutable"();
