CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "AuditLog"
  ADD COLUMN "previousHash" TEXT,
  ADD COLUMN "recordHash" TEXT;
CREATE UNIQUE INDEX "AuditLog_recordHash_key" ON "AuditLog"("recordHash");

CREATE OR REPLACE FUNCTION pactagent_hash_audit_log() RETURNS trigger AS $$
DECLARE
  prior_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('pactagent-audit-chain'));
  SELECT "recordHash" INTO prior_hash
    FROM "AuditLog" WHERE "recordHash" IS NOT NULL
    ORDER BY "createdAt" DESC, "id" DESC LIMIT 1;
  NEW."previousHash" := prior_hash;
  NEW."recordHash" := encode(digest(concat_ws('|',
    coalesce(prior_hash, ''), NEW."id", coalesce(NEW."appId", ''),
    NEW."actorType", NEW."action", NEW."resourceType", NEW."resourceId",
    coalesce(NEW."beforeJson", ''), coalesce(NEW."afterJson", ''),
    NEW."createdAt"::text
  ), 'sha256'), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pactagent_reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('pactagent.audit_maintenance', true) = 'authorized' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_hash_before_insert"
  BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION pactagent_hash_audit_log();
CREATE TRIGGER "AuditLog_reject_update_delete"
  BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION pactagent_reject_audit_mutation();

CREATE TABLE "AuditLogArchive" (LIKE "AuditLog" INCLUDING ALL);
ALTER TABLE "AuditLogArchive" ADD COLUMN "archivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION pactagent_archive_audit_logs(older_than TIMESTAMPTZ) RETURNS BIGINT AS $$
DECLARE archived BIGINT;
BEGIN
  INSERT INTO "AuditLogArchive" SELECT a.*, CURRENT_TIMESTAMP FROM "AuditLog" a
    WHERE a."createdAt" < older_than
    ON CONFLICT ("id") DO NOTHING;
  GET DIAGNOSTICS archived = ROW_COUNT;
  RETURN archived;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
