#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${ALLOW_RESTORE_VERIFICATION:?Set ALLOW_RESTORE_VERIFICATION=true}"
test "$ALLOW_RESTORE_VERIFICATION" = true
case "$RESTORE_DATABASE_URL" in
  *restore*|*verify*|*test*) ;;
  *) echo "Refusing restore: target database name must contain restore, verify, or test" >&2; exit 2 ;;
esac

pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE"
DATABASE_URL="$RESTORE_DATABASE_URL" DIRECT_URL="$RESTORE_DATABASE_URL" npm run db:migrate:status --workspace @pact-agent/server
DATABASE_URL="$RESTORE_DATABASE_URL" npm run audit:tenant-integrity --workspace @pact-agent/server
DATABASE_URL="$RESTORE_DATABASE_URL" npm run audit:verify --workspace @pact-agent/server
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT CASE WHEN to_regclass('public."App"') IS NOT NULL THEN 'schema:ok' ELSE CAST(1/0 AS text) END;
SELECT 'apps:' || COUNT(*) FROM "App";
SELECT 'agreements:' || COUNT(*) FROM "Agreement";
SELECT 'jobs:' || COUNT(*) FROM "AgentJob";
SELECT 'audit:' || COUNT(*) FROM "AuditLog";
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM "Milestone" child JOIN "Agreement" parent ON parent.id = child."agreementId"
  WHERE child."appId" <> parent."appId"
) THEN 'tenant_constraints:ok' ELSE CAST(1/0 AS text) END;
SQL
echo "Restore verification completed for isolated target."
