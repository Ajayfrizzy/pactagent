-- New versioned local lifecycle; preserve all prior immutable local/M1 evidence.
CREATE TABLE "BaseLocalCommand" (
 "id" TEXT PRIMARY KEY, "appId" TEXT NOT NULL, "escrowId" TEXT NOT NULL,
 "idempotencyKey" TEXT NOT NULL CHECK(length("idempotencyKey") BETWEEN 1 AND 200),
 "action" TEXT NOT NULL CHECK("action" IN ('funding','mutual','dispute','arbitration','fallback','cancel:0','cancel:1','cancel:2')),
 "epoch" TEXT NOT NULL CHECK("epoch" ~ '^(0|[1-9][0-9]{0,77})$'),
 "transactionId" TEXT NOT NULL UNIQUE CHECK("transactionId" ~ '^0x[0-9a-f]{64}$'),
 "sender" TEXT NOT NULL CHECK("sender" ~ '^0x[0-9a-f]{40}$'), "nonce" INTEGER NOT NULL CHECK("nonce">=0),
 "requestHash" TEXT NOT NULL, "encryptedArtifact" TEXT NOT NULL, "keyVersion" TEXT NOT NULL,
 "codeHash" TEXT NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("id","appId"), UNIQUE("appId","idempotencyKey"), UNIQUE("escrowId","action","epoch"), UNIQUE("sender","nonce"),
 FOREIGN KEY("escrowId","appId") REFERENCES "BaseLocalEscrow"("id","appId") ON DELETE RESTRICT
);
CREATE TABLE "BaseLocalDispatch" (
 "commandId" TEXT PRIMARY KEY, "appId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'queued' CHECK("status" IN ('queued','unknown','included','finalized','reconciliation_required')),
 "leaseOwner" TEXT, "leaseUntil" TIMESTAMPTZ, "attempts" INTEGER NOT NULL DEFAULT 0,
 "blockHash" TEXT, "blockNumber" TEXT, "lastEvidenceHash" TEXT,
 "availableAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("commandId","appId") REFERENCES "BaseLocalCommand"("id","appId") ON DELETE RESTRICT
);
CREATE INDEX "BaseLocalDispatch_availableAt_idx" ON "BaseLocalDispatch"("availableAt");
CREATE TABLE "BaseLocalCommandEvidence" (
 "id" TEXT PRIMARY KEY, "commandId" TEXT NOT NULL, "appId" TEXT NOT NULL, "sequence" INTEGER NOT NULL CHECK("sequence">0),
 "evidenceJson" TEXT NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("commandId","sequence"),
 FOREIGN KEY("commandId","appId") REFERENCES "BaseLocalCommand"("id","appId") ON DELETE RESTRICT
);
CREATE TRIGGER "BaseLocalCommand_immutable" BEFORE UPDATE OR DELETE ON "BaseLocalCommand" FOR EACH ROW EXECUTE FUNCTION "m2_local_immutable"();
CREATE TRIGGER "BaseLocalCommandEvidence_immutable" BEFORE UPDATE OR DELETE ON "BaseLocalCommandEvidence" FOR EACH ROW EXECUTE FUNCTION "m2_local_immutable"();
