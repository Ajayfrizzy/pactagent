\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(value BOOLEAN, message TEXT)
RETURNS VOID AS $$
BEGIN
  IF value IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration upgrade verification failed: %', message;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Representative infrastructure records and tenant relationships survive.
SELECT pg_temp.assert_true(
  (SELECT name = 'Upgrade Fixture' AND "ownerId" = 'upgrade-owner'
   FROM public."App" WHERE id = '00000000-0000-4000-8000-000000000099'),
  'app was not preserved with its renamed owner field'
);
SELECT pg_temp.assert_true(
  (SELECT "appId" = '00000000-0000-4000-8000-000000000099'
   FROM public."ApiKey" WHERE id = '00000000-0000-4000-8000-000000000109'),
  'API key tenancy was not preserved'
);
SELECT pg_temp.assert_true(
  (SELECT title = 'Existing agreement'
   FROM public."Agreement" WHERE id = '00000000-0000-4000-8000-000000000199'),
  'agreement was not preserved'
);
SELECT pg_temp.assert_true(
  (SELECT "agreementId" = '00000000-0000-4000-8000-000000000199'
   FROM public."Milestone" WHERE id = '00000000-0000-4000-8000-000000000299'),
  'milestone relationship was not preserved'
);
SELECT pg_temp.assert_true(
  (SELECT "agreementId" = '00000000-0000-4000-8000-000000000199'
      AND "milestoneId" = '00000000-0000-4000-8000-000000000299'
   FROM public."Proof" WHERE id = '00000000-0000-4000-8000-000000000309'),
  'proof relationships were not preserved'
);
SELECT pg_temp.assert_true(
  (SELECT "proofSubmissionId" = '00000000-0000-4000-8000-000000000309'
   FROM public."Review" WHERE id = '00000000-0000-4000-8000-000000000319'),
  'review relationship was not preserved'
);
SELECT pg_temp.assert_true(
  (SELECT "agreementId" = '00000000-0000-4000-8000-000000000199'
   FROM public."Dispute" WHERE id = '00000000-0000-4000-8000-000000000329'),
  'dispute relationship was not preserved'
);
SELECT pg_temp.assert_true(
  (SELECT "milestoneId" = '00000000-0000-4000-8000-000000000299'
   FROM public."Escrow" WHERE id = '00000000-0000-4000-8000-000000000339'),
  'escrow relationship was not preserved'
);
SELECT pg_temp.assert_true(
  (SELECT "escrowId" = '00000000-0000-4000-8000-000000000339'
      AND "rawPayloadJson" = '{"fixture":true}'
   FROM public."Transaction" WHERE id = '00000000-0000-4000-8000-000000000399'),
  'transaction data or relationship was not preserved'
);
SELECT pg_temp.assert_true(
  (SELECT "responseBodyJson"->'data'->>'id' = 'fixture'
   FROM public."IdempotencyKey" WHERE id = '00000000-0000-4000-8000-000000000499'),
  'idempotency response data was not preserved'
);
SELECT pg_temp.assert_true(
  (SELECT "proofSubmissionId" = '00000000-0000-4000-8000-000000000309'
      AND "disputeId" = '00000000-0000-4000-8000-000000000329'
   FROM public."Event" WHERE id = '00000000-0000-4000-8000-000000000409'),
  'event relationships were not preserved'
);
SELECT pg_temp.assert_true(
  (SELECT action = 'upgrade.fixture.created'
   FROM public."AuditLog" WHERE id = '00000000-0000-4000-8000-000000000449'),
  'audit log was not preserved'
);
SELECT pg_temp.assert_true(
  (SELECT "appId" = '00000000-0000-4000-8000-000000000099'
      AND queue = 'webhook' AND kind = 'DELIVER_WEBHOOK'
   FROM public."AgentJob" WHERE id = '00000000-0000-4000-8000-000000000459'),
  'webhook job tenancy or queue was not preserved'
);

-- Complete current webhook material remains operational.
SELECT pg_temp.assert_true(
  (SELECT status = 'active'
      AND "secretHash" = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      AND "secretCiphertext" = 'v1.fixture-current-ciphertext'
      AND "encryptionKeyVersion" = 'legacy'
   FROM public."WebhookEndpoint" WHERE id = '00000000-0000-4000-8000-000000000419'),
  'current webhook signing material or active status was not preserved'
);

-- A plaintext-only endpoint is explicitly non-deliverable and no plaintext is
-- repurposed as a hash or retained in the operational schema.
SELECT pg_temp.assert_true(
  (SELECT status = 'disabled'
      AND "secretHash" IS NULL
      AND "secretCiphertext" IS NULL
      AND "encryptionKeyVersion" IS NULL
   FROM public."WebhookEndpoint" WHERE id = '00000000-0000-4000-8000-000000000429'),
  'plaintext-only webhook was not disabled with empty current secret fields'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'WebhookEndpoint'
      AND column_name = 'signingSecret'
  ),
  'plaintext signingSecret remains in the operational schema'
);
SELECT pg_temp.assert_true(
  (SELECT "endpointId" = '00000000-0000-4000-8000-000000000419'
      AND "appId" = '00000000-0000-4000-8000-000000000099'
      AND "agreementId" = '00000000-0000-4000-8000-000000000199'
   FROM public."WebhookDelivery" WHERE id = '00000000-0000-4000-8000-000000000439'),
  'webhook delivery relationships were not preserved'
);

-- Current API-created rows have complete secret material and satisfy the active
-- endpoint constraint after migration.
INSERT INTO public."WebhookEndpoint" (
  id, "appId", url, "subscribedEvents", "secretHash", "secretCiphertext",
  "encryptionKeyVersion", status, "createdAt", "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000469', '00000000-0000-4000-8000-000000000099',
  'https://example.com/post-migration-webhook', ARRAY['agreement.created'],
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'v2.current.fixture-ciphertext', 'current', 'active', now(), now()
);
SELECT pg_temp.assert_true(
  (SELECT status = 'active' AND "encryptionKeyVersion" = 'current'
   FROM public."WebhookEndpoint" WHERE id = '00000000-0000-4000-8000-000000000469'),
  'post-migration webhook endpoint could not be created normally'
);

DO $$
BEGIN
  BEGIN
    UPDATE public."WebhookEndpoint"
    SET status = 'active'
    WHERE id = '00000000-0000-4000-8000-000000000429';
    RAISE EXCEPTION 'active endpoint secret-material constraint did not reject an incomplete endpoint';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

-- All archived webhook plaintext is redacted, including operational duplicate
-- fields and the retired compatibility tenant copy.
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2
   FROM legacy_product_archive."WebhookEndpointFields"
   WHERE id IN (
     '00000000-0000-4000-8000-000000000419',
     '00000000-0000-4000-8000-000000000429'
   ) AND "signingSecret" = '[redacted]'),
  'operational webhook archive metadata did not redact plaintext secrets'
);
SELECT pg_temp.assert_true(
  (SELECT "signingSecret" = '[redacted]'
      AND "secretHash" IS NULL
      AND "secretCiphertext" IS NULL
   FROM legacy_product_archive."LegacyWebhookEndpoint"
   WHERE id = '00000000-0000-4000-8000-000000000706'),
  'retired compatibility webhook archive retained secret material'
);

-- Legacy product data is archived and removed from the operational schema.
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM legacy_product_archive."User"
   WHERE id = '00000000-0000-4000-8000-000000000701'),
  'legacy user was not archived'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM legacy_product_archive."AgreementSource"
   WHERE id = '00000000-0000-4000-8000-000000000705'),
  'legacy agreement source was not archived'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM legacy_product_archive."LegacyAuditLog"
   WHERE id = '00000000-0000-4000-8000-000000000707'),
  'legacy audit log was not archived'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM legacy_product_archive."LegacyAgentJob"
   WHERE id = '00000000-0000-4000-8000-000000000708'),
  'legacy agent job was not archived'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public."App"
    WHERE id = '00000000-0000-4000-8000-000000000001'
  ),
  'legacy compatibility app remains operational'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'User', 'PublicProfile', 'ReputationSnapshot', 'InviteLink',
      'AgreementSource', 'DisputeEvidence', 'AgentLog', 'MilestoneSettlement',
      'AgreementComment', 'AgreementAmendment', 'ProofCheck', 'InfoRequest'
    ]) AS removed(table_name)
    WHERE to_regclass(format('public.%I', removed.table_name)) IS NOT NULL
  ),
  'one or more retired product tables remain operational'
);

-- PUBLIC retains no access to the archive schema, tables, or helper function.
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_namespace namespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
    ) privileges
    WHERE namespace.nspname = 'legacy_product_archive'
      AND privileges.grantee = 0
  ),
  'PUBLIC retains archive schema privileges'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(relation.relacl, acldefault('r', relation.relowner))
    ) privileges
    WHERE namespace.nspname = 'legacy_product_archive'
      AND relation.relkind IN ('r', 'p')
      AND privileges.grantee = 0
  ),
  'PUBLIC retains archive table privileges'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
    ) privileges
    WHERE namespace.nspname = 'legacy_product_archive'
      AND privileges.grantee = 0
  ),
  'PUBLIC retains archive function privileges'
);
