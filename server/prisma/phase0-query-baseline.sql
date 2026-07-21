\set ON_ERROR_STOP on
\timing on

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, status, "availableAt", "createdAt"
FROM "AgentJob"
WHERE status IN ('QUEUED', 'RETRY')
  AND "availableAt" <= now()
ORDER BY "availableAt", "createdAt"
LIMIT 10;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, "appId", status, "createdAt"
FROM "Agreement"
WHERE "appId" = '00000000-0000-4000-8000-000000000099'
ORDER BY "createdAt" DESC
LIMIT 20;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, "appId", status, "nextRetryAt", "createdAt"
FROM "WebhookDelivery"
WHERE "appId" = '00000000-0000-4000-8000-000000000099'
  AND status IN ('PENDING', 'RETRY')
  AND "nextRetryAt" <= now()
ORDER BY "nextRetryAt", "createdAt"
LIMIT 20;
