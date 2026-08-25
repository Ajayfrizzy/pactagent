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

-- Representative standalone-product rows exercise archive, redaction, and
-- compatibility-tenant removal in the cleanup migrations.
INSERT INTO "User" (id, "walletAddress", role)
VALUES ('00000000-0000-4000-8000-000000000701', 'ckt-legacy-user', 'worker');

INSERT INTO "PublicProfile" (id, "walletAddress", handle, "displayName", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000702', 'ckt-legacy-user', 'legacy-worker', 'Legacy Worker', now());

INSERT INTO "InviteLink" (
  id, token, "createdByAddress", "creatorRole", "targetRole", "agreementTemplateJson", "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000703', 'legacy-invite-token', 'ckt-legacy-user',
  'client', 'worker', '{"title":"Legacy invite"}', now()
);

INSERT INTO "App" (id, name, slug, "ownerUserId", environment, status, "defaultCurrency", "defaultNetwork", "createdAt", "updatedAt")
VALUES (
  '00000000-0000-4000-8000-000000000001', 'Legacy Product', 'legacy-product',
  'legacy-product-owner', 'sandbox', 'active', 'CKB', 'sandbox', now(), now()
);

INSERT INTO "Agreement" (
  id, "appId", title, description, "clientAddress", "workerAddress", amount, currency,
  "deadlineAt", status, "createdAt", "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000704', '00000000-0000-4000-8000-000000000001',
  'Legacy product agreement', 'Must leave the operational schema', 'ckt-legacy-client',
  'ckt-legacy-worker', '50000000', 'CKB', now() + interval '7 days', 'DRAFT', now(), now()
);

INSERT INTO "AgreementSource" (
  id, "agreementId", "sourceType", "sourceLabel", "externalUrl", "bountyTitle",
  "createdByAddress", "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000705', '00000000-0000-4000-8000-000000000704',
  'NERVOS_TALK', 'Legacy forum', 'https://talk.nervos.org/t/legacy', 'Legacy bounty',
  'ckt-legacy-client', now()
);

INSERT INTO "WebhookEndpoint" (
  id, "appId", "ownerAddress", label, "targetUrl", "eventTypesJson", "signingSecret",
  "secretHash", "secretCiphertext", status, "isActive", "createdAt", "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000706', '00000000-0000-4000-8000-000000000001',
  'ckt-legacy-client', 'Legacy webhook', 'https://example.com/legacy-webhook', '["agreement.updated"]',
  'legacy-signing-secret', 'legacy-secret-hash', 'v1.legacy-ciphertext', 'active', true, now(), now()
);

INSERT INTO "AuditLog" (
  id, "appId", "agreementId", "actorType", action, "resourceType", "resourceId", "createdAt"
) VALUES (
  '00000000-0000-4000-8000-000000000707', '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000704', 'operator', 'legacy.created', 'agreement',
  '00000000-0000-4000-8000-000000000704', now()
);

INSERT INTO "AgentJob" (
  id, "agreementId", kind, status, "payloadJson", "createdAt", "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000708', '00000000-0000-4000-8000-000000000704',
  'SYNC_SOURCE', 'QUEUED', '{"sourceId":"00000000-0000-4000-8000-000000000705"}', now(), now()
);
