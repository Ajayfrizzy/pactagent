-- Preserve retired standalone-product data outside the operational schema.
CREATE SCHEMA IF NOT EXISTS legacy_product_archive;

CREATE FUNCTION legacy_product_archive.try_parse_jsonb(value TEXT)
RETURNS JSONB AS $$
BEGIN
  RETURN value::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE TABLE legacy_product_archive."User" AS TABLE public."User";
CREATE TABLE legacy_product_archive."PublicProfile" AS TABLE public."PublicProfile";
CREATE TABLE legacy_product_archive."ReputationSnapshot" AS TABLE public."ReputationSnapshot";
CREATE TABLE legacy_product_archive."InviteLink" AS TABLE public."InviteLink";
CREATE TABLE legacy_product_archive."AgreementSource" AS TABLE public."AgreementSource";
CREATE TABLE legacy_product_archive."DisputeEvidence" AS TABLE public."DisputeEvidence";
CREATE TABLE legacy_product_archive."AgentLog" AS TABLE public."AgentLog";
CREATE TABLE legacy_product_archive."MilestoneSettlement" AS TABLE public."MilestoneSettlement";
CREATE TABLE legacy_product_archive."AgreementComment" AS TABLE public."AgreementComment";
CREATE TABLE legacy_product_archive."AgreementAmendment" AS TABLE public."AgreementAmendment";
CREATE TABLE legacy_product_archive."ProofCheck" AS TABLE public."ProofCheck";
CREATE TABLE legacy_product_archive."InfoRequest" AS TABLE public."InfoRequest";

-- The historical wallet API used a fixed compatibility tenant. Archive its
-- app-scoped lifecycle records before removing it from the infrastructure core.
CREATE TABLE legacy_product_archive."LegacyApp" AS
  SELECT * FROM public."App"
  WHERE id = '00000000-0000-4000-8000-000000000001';
CREATE TABLE legacy_product_archive."LegacyApiKey" AS
  SELECT * FROM public."ApiKey"
  WHERE "appId" = '00000000-0000-4000-8000-000000000001';
CREATE TABLE legacy_product_archive."LegacyAgreement" AS
  SELECT * FROM public."Agreement"
  WHERE "appId" = '00000000-0000-4000-8000-000000000001';
CREATE TABLE legacy_product_archive."LegacyMilestone" AS
  SELECT * FROM public."Milestone"
  WHERE "appId" = '00000000-0000-4000-8000-000000000001';
CREATE TABLE legacy_product_archive."LegacyProof" AS
  SELECT * FROM public."Proof"
  WHERE "appId" = '00000000-0000-4000-8000-000000000001';
CREATE TABLE legacy_product_archive."LegacyReview" AS
  SELECT * FROM public."Review"
  WHERE "appId" = '00000000-0000-4000-8000-000000000001';
CREATE TABLE legacy_product_archive."LegacyDispute" AS
  SELECT * FROM public."Dispute"
  WHERE "appId" = '00000000-0000-4000-8000-000000000001';
CREATE TABLE legacy_product_archive."LegacyEscrow" AS
  SELECT * FROM public."Escrow"
  WHERE "appId" = '00000000-0000-4000-8000-000000000001';
CREATE TABLE legacy_product_archive."LegacyTransaction" AS
  SELECT * FROM public."Transaction"
  WHERE "appId" = '00000000-0000-4000-8000-000000000001';
CREATE TABLE legacy_product_archive."LegacyEvent" AS
  SELECT * FROM public."Event"
  WHERE "appId" = '00000000-0000-4000-8000-000000000001';
CREATE TABLE legacy_product_archive."LegacyWebhookEndpoint" AS
  SELECT * FROM public."WebhookEndpoint"
  WHERE "appId" IS NULL OR "appId" = '00000000-0000-4000-8000-000000000001';
UPDATE legacy_product_archive."LegacyWebhookEndpoint"
SET
  "signingSecret" = '[redacted]',
  "secretHash" = NULL,
  "secretCiphertext" = NULL;
CREATE TABLE legacy_product_archive."LegacyWebhookDelivery" AS
  SELECT * FROM public."WebhookDelivery"
  WHERE "appId" IS NULL OR "appId" = '00000000-0000-4000-8000-000000000001';
CREATE TABLE legacy_product_archive."LegacyIdempotencyKey" AS
  SELECT * FROM public."IdempotencyKey"
  WHERE "appId" = '00000000-0000-4000-8000-000000000001';
CREATE TABLE legacy_product_archive."LegacyAuditLog" AS
  SELECT * FROM public."AuditLog"
  WHERE "appId" = '00000000-0000-4000-8000-000000000001';
CREATE TABLE legacy_product_archive."LegacyAgentJob" AS
  SELECT job.*
  FROM public."AgentJob" job
  LEFT JOIN public."Agreement" agreement ON agreement.id = job."agreementId"
  WHERE agreement."appId" = '00000000-0000-4000-8000-000000000001'
     OR EXISTS (
       SELECT 1 FROM public."WebhookDelivery" delivery
       WHERE delivery.id = NULLIF(legacy_product_archive.try_parse_jsonb(job."payloadJson") ->> 'deliveryId', '')
         AND (delivery."appId" IS NULL OR delivery."appId" = '00000000-0000-4000-8000-000000000001')
     );

-- Retired product tables are no longer allowed to constrain core lifecycle rows.
DROP TABLE public."AgreementSource";
DROP TABLE public."DisputeEvidence";
DROP TABLE public."AgentLog";
DROP TABLE public."MilestoneSettlement";
DROP TABLE public."AgreementComment";
DROP TABLE public."AgreementAmendment";
DROP TABLE public."ProofCheck";
DROP TABLE public."InfoRequest";
DROP TABLE public."InviteLink";
DROP TABLE public."ReputationSnapshot";
DROP TABLE public."PublicProfile";
DROP TABLE public."User";

DELETE FROM public."AgentJob" job
USING public."Agreement" agreement
WHERE job."agreementId" = agreement.id
  AND agreement."appId" = '00000000-0000-4000-8000-000000000001';
DELETE FROM public."AgentJob" job
WHERE EXISTS (
  SELECT 1 FROM public."WebhookDelivery" delivery
  WHERE delivery.id = NULLIF(legacy_product_archive.try_parse_jsonb(job."payloadJson") ->> 'deliveryId', '')
    AND (delivery."appId" IS NULL OR delivery."appId" = '00000000-0000-4000-8000-000000000001')
);
DELETE FROM public."WebhookDelivery"
WHERE "appId" IS NULL OR "appId" = '00000000-0000-4000-8000-000000000001';
DELETE FROM public."Event" WHERE "appId" = '00000000-0000-4000-8000-000000000001';
SET pactagent.audit_maintenance = 'authorized';
DELETE FROM public."AuditLog" WHERE "appId" = '00000000-0000-4000-8000-000000000001';
RESET pactagent.audit_maintenance;
DELETE FROM public."Transaction" WHERE "appId" = '00000000-0000-4000-8000-000000000001';
DELETE FROM public."Review" WHERE "appId" = '00000000-0000-4000-8000-000000000001';
DELETE FROM public."Dispute" WHERE "appId" = '00000000-0000-4000-8000-000000000001';
DELETE FROM public."Proof" WHERE "appId" = '00000000-0000-4000-8000-000000000001';
DELETE FROM public."Escrow" WHERE "appId" = '00000000-0000-4000-8000-000000000001';
DELETE FROM public."Milestone" WHERE "appId" = '00000000-0000-4000-8000-000000000001';
DELETE FROM public."IdempotencyKey" WHERE "appId" = '00000000-0000-4000-8000-000000000001';
DELETE FROM public."WebhookEndpoint"
WHERE "appId" IS NULL OR "appId" = '00000000-0000-4000-8000-000000000001';
DELETE FROM public."Agreement" WHERE "appId" = '00000000-0000-4000-8000-000000000001';
DELETE FROM public."ApiKey" WHERE "appId" = '00000000-0000-4000-8000-000000000001';
DELETE FROM public."App" WHERE id = '00000000-0000-4000-8000-000000000001';

REVOKE ALL ON SCHEMA legacy_product_archive FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA legacy_product_archive FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA legacy_product_archive FROM PUBLIC;
