-- A global transaction advisory lock made every audited operation contend with
-- every other tenant. Preserve cryptographic linkage while allowing concurrent
-- inserts to branch from the same valid predecessor.
CREATE OR REPLACE FUNCTION pactagent_hash_audit_log() RETURNS trigger AS $$
DECLARE
  prior_hash TEXT;
BEGIN
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
