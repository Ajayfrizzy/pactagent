-- Run after the Phase 1 migration set and before Phase 2 migrations.
-- Fixed IDs make post-upgrade identity and relationship verification explicit.
INSERT INTO "App" (
  id, name, slug, "ownerId", environment, status, "defaultCurrency", "defaultNetwork", "createdAt", "updatedAt"
) VALUES (
  '10000000-0000-4000-8000-000000000001', 'Phase 2 upgrade fixture', 'phase2-upgrade-fixture',
  'phase2-upgrade-owner', 'sandbox', 'active', 'CKB', 'sandbox', now(), now()
);

INSERT INTO "ApiKey" (
  id, "appId", name, "keyPrefix", "keyHash", environment, status, scopes, "createdAt"
) VALUES (
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
  'upgrade fixture key', 'pa_test_fixture', repeat('a', 64), 'sandbox', 'active',
  ARRAY['agreements:read'], now()
);

INSERT INTO "Agreement" (
  id, "appId", title, description, "clientExternalId", "workerExternalId", amount, currency,
  "deadlineAt", "disputeWindowSecs", "releaseMode", "disputeMode", "settlementStatus", status,
  "createdAt", "updatedAt"
) VALUES (
  '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
  'Historical agreement', 'Populated Phase 1 fixture', 'client-fixture', 'worker-fixture', '1000', 'CKB',
  now() + interval '7 days', 86400, 'milestone', 'app_managed', 'UNFUNDED', 'DRAFT', now(), now()
);

INSERT INTO "Milestone" (
  id, "appId", "agreementId", title, description, amount, currency, "sortOrder", status, "createdAt", "updatedAt"
) VALUES (
  '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003', 'Historical milestone', 'Phase 1 milestone',
  '1000', NULL, 1, 'PENDING', now(), now()
);

INSERT INTO "Proof" (
  id, "appId", "agreementId", "milestoneId", "proofType", content, "contentHash", status, "submittedAt", "updatedAt"
) VALUES (
  '10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004',
  'TEXT', 'Historical proof', repeat('b', 64), 'submitted', now(), now()
);

INSERT INTO "Review" (
  id, "appId", "agreementId", "milestoneId", "proofSubmissionId", "reviewerExternalId", decision, note, "createdAt"
) VALUES (
  '10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005', 'reviewer-fixture', 'approved', 'Historical review', now()
);

INSERT INTO "Dispute" (
  id, "appId", "agreementId", "milestoneId", "openedByExternalId", reason, status, "createdAt"
) VALUES (
  '10000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004',
  'client-fixture', 'Historical open dispute', 'open', now()
);

INSERT INTO "Escrow" (
  id, "appId", "agreementId", "milestoneId", amount, currency, rail, network, status, "lockTxHash", "createdAt", "updatedAt"
) VALUES (
  '10000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004',
  '1000', 'CKB', 'mock', 'sandbox', 'awaiting_funding', 'mock_upgrade_lock', now(), now()
);

INSERT INTO "Transaction" (
  id, "appId", "agreementId", "milestoneId", "escrowId", type, rail, network, status,
  "txHash", amount, currency, "createdAt", "updatedAt"
) VALUES (
  '10000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000008', 'lock', 'mock', 'sandbox', 'pending',
  'mock_upgrade_lock', '1000', 'CKB', now(), now()
);

INSERT INTO "Event" (
  id, "appId", type, "agreementId", "milestoneId", "escrowId", "proofSubmissionId", "disputeId", "payloadJson", "createdAt"
) VALUES (
  '10000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001', 'fixture.created',
  '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000007', '{}', now()
);

INSERT INTO "WebhookEndpoint" (
  id, "appId", url, description, "subscribedEvents", status, "createdAt", "updatedAt"
) VALUES (
  '10000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001',
  'https://example.com/phase2-fixture', 'Disabled fixture', ARRAY[]::text[], 'disabled', now(), now()
);

INSERT INTO "WebhookDelivery" (
  id, "appId", "endpointId", "eventId", "agreementId", "eventType", "payloadJson", "payloadHash",
  status, attempts, "createdAt", "updatedAt"
) VALUES (
  '10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000003', 'fixture.created', '{}', repeat('c', 64), 'PENDING', 0, now(), now()
);

INSERT INTO "AuditLog" (
  id, "appId", "agreementId", "actorType", action, "resourceType", "resourceId", "targetType", "targetId", "createdAt"
) VALUES (
  '10000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003', 'system', 'fixture.created', 'agreement',
  '10000000-0000-4000-8000-000000000003', 'agreement', '10000000-0000-4000-8000-000000000003', now()
);

INSERT INTO "AgentJob" (
  id, "appId", "agreementId", kind, queue, status, "dedupeKey", "payloadJson", "availableAt", "createdAt", "updatedAt"
) VALUES (
  '10000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003', 'DELIVER_WEBHOOK', 'webhook', 'QUEUED',
  'PHASE2_UPGRADE_FIXTURE', '{"deliveryId":"10000000-0000-4000-8000-000000000012"}', now(), now(), now()
);

INSERT INTO "IdempotencyKey" (
  id, "appId", key, "requestHash", status, "responseStatus", "responseBodyJson", "responseBytes",
  "processingExpiresAt", "expiresAt", "createdAt", "updatedAt"
) VALUES (
  '10000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000001',
  'phase2-upgrade-fixture', repeat('d', 64), 'completed', 201, '{"data":{"preserved":true}}'::jsonb, 27,
  now() + interval '5 minutes', now() + interval '1 day', now(), now()
);
