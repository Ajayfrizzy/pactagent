-- Retain prior raw bytes; same relayer nonce may be replaced only by an explicit
-- same-tenant/escrow/action successor at a higher cryptographic intent epoch.
ALTER TABLE "BaseLocalCommand" ADD COLUMN "replacesTransactionId" TEXT;
ALTER TABLE "BaseLocalCommand" ADD CONSTRAINT "BaseLocalCommand_transactionId_appId_key" UNIQUE("transactionId","appId");
ALTER TABLE "BaseLocalCommand" ADD CONSTRAINT "BaseLocalCommand_replacesTransactionId_key" UNIQUE("replacesTransactionId");
ALTER TABLE "BaseLocalCommand" ADD CONSTRAINT "BaseLocalCommand_replacement_fkey" FOREIGN KEY("replacesTransactionId","appId") REFERENCES "BaseLocalCommand"("transactionId","appId") ON DELETE RESTRICT;
ALTER TABLE "BaseLocalCommand" DROP CONSTRAINT "BaseLocalCommand_sender_nonce_key";
CREATE INDEX "BaseLocalCommand_sender_nonce_idx" ON "BaseLocalCommand"("sender","nonce");
CREATE FUNCTION "m2_local_replacement_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior "BaseLocalCommand";
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(NEW."sender"),NEW."nonce");
 SELECT * INTO prior FROM "BaseLocalCommand" WHERE "sender"=NEW."sender" AND "nonce"=NEW."nonce" ORDER BY "epoch"::numeric DESC LIMIT 1;
 IF FOUND THEN
  IF NEW."replacesTransactionId" IS DISTINCT FROM prior."transactionId"
    OR NEW."appId"<>prior."appId" OR NEW."escrowId"<>prior."escrowId" OR NEW."action"<>prior."action"
    OR NEW."action" NOT IN ('funding','mutual','arbitration') OR NEW."epoch"::numeric<=prior."epoch"::numeric THEN
    RAISE EXCEPTION 'replacement requires the same scoped action at a newer onchain epoch' USING ERRCODE='23514';
  END IF;
 ELSIF NEW."replacesTransactionId" IS NOT NULL THEN
  RAISE EXCEPTION 'replacement transaction identity mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "BaseLocalCommand_replacement_guard" BEFORE INSERT ON "BaseLocalCommand" FOR EACH ROW EXECUTE FUNCTION "m2_local_replacement_guard"();
