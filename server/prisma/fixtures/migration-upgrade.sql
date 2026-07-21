\set ON_ERROR_STOP on

INSERT INTO "App" (id, name, slug, "ownerUserId", environment, status, "defaultCurrency", "defaultNetwork", "createdAt", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000099', 'Upgrade Fixture', 'upgrade-fixture', 'upgrade-owner', 'sandbox', 'active', 'CKB', 'sandbox', now(), now());

INSERT INTO "Agreement" (
  id, "appId", title, description, "clientAddress", "workerAddress", amount, currency,
  "deadlineAt", status, "createdAt", "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000199', '00000000-0000-4000-8000-000000000099',
  'Existing agreement', 'Representative pre-migration agreement', 'client-fixture', 'worker-fixture',
  '100000000', 'CKB', now() + interval '30 days', 'draft', now(), now()
);

INSERT INTO "Milestone" (
  id, "appId", "agreementId", title, description, amount, currency, "sortOrder", status, "createdAt", "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000299', '00000000-0000-4000-8000-000000000099',
  '00000000-0000-4000-8000-000000000199', 'Existing milestone', 'Representative milestone',
  '100000000', 'CKB', 1, 'pending', now(), now()
);

INSERT INTO "Transaction" (
  id, "appId", "agreementId", type, rail, network, status, "txHash", amount, currency, "rawPayloadJson", "createdAt", "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000399', '00000000-0000-4000-8000-000000000099',
  '00000000-0000-4000-8000-000000000199', 'lock', 'mock', 'sandbox', 'confirmed',
  'fixture-upgrade-tx', '100000000', 'CKB', '{"fixture":true}', now(), now()
);

INSERT INTO "IdempotencyKey" (
  id, "appId", key, "requestHash", status, "responseStatus", "responseBodyJson", "createdAt", "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000499', '00000000-0000-4000-8000-000000000099',
  'upgrade-fixture-key', 'fixture-hash', 'completed', 201, '{"data":{"id":"fixture"}}', now(), now()
);
