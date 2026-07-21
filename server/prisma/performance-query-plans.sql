EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT id FROM "AgentJob" WHERE queue = 'settlement' AND status IN ('QUEUED','RETRY') AND "availableAt" <= now()
ORDER BY "availableAt", "createdAt" LIMIT 100;

EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT id FROM "WebhookDelivery" WHERE status IN ('PENDING','RETRY') AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= now())
ORDER BY "nextRetryAt", "createdAt" LIMIT 100;

EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT id, status, "createdAt" FROM "Agreement" WHERE "appId" = '00000000-0000-4000-8000-000000000099'
ORDER BY "createdAt" DESC, id DESC LIMIT 101;

EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT id, "recordHash", "previousHash" FROM "AuditLog" WHERE "appId" = '00000000-0000-4000-8000-000000000099'
ORDER BY "createdAt" DESC, id DESC LIMIT 101;
