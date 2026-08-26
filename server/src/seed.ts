import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getApiKeyPrefix, hashApiKey } from './common/crypto/api-keys';
import { encryptWebhookSecret, hashWebhookSecret } from './modules/webhooks/webhook.signing';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function proofHash(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

async function main() {
  const ownerId = process.env.SEED_OWNER_ID || 'seed-developer';
  const app = await prisma.app.upsert({
    where: { id: 'sandbox-demo-app' },
    update: {
      name: 'Sandbox Developer Project',
      slug: 'sandbox-developer-project',
      ownerId,
      environment: 'sandbox',
      status: 'active',
      defaultCurrency: 'CKB',
      defaultNetwork: 'sandbox',
    },
    create: {
      id: 'sandbox-demo-app',
      name: 'Sandbox Developer Project',
      slug: 'sandbox-developer-project',
      ownerId,
      environment: 'sandbox',
      status: 'active',
      defaultCurrency: 'CKB',
      defaultNetwork: 'sandbox',
    },
  });

  const rawApiKey = process.env.SEED_SANDBOX_API_KEY
    || 'pa_test_seed_developer_console_key_000000000000000000000000';
  const scopes = [
    'apps:read',
    'agreements:create', 'agreements:read', 'agreements:update', 'agreements:cancel',
    'milestones:create', 'milestones:read',
    'escrows:create', 'escrows:read', 'escrows:fund', 'escrows:release', 'escrows:refund',
    'proofs:create', 'proofs:read', 'proofs:review',
    'disputes:create', 'disputes:read', 'disputes:resolve',
    'events:read', 'webhooks:manage', 'webhooks:read',
  ];

  await prisma.apiKey.upsert({
    where: { id: 'sandbox-developer-api-key' },
    update: {
      appId: app.id,
      name: 'Sandbox Developer Key',
      keyPrefix: getApiKeyPrefix(rawApiKey),
      keyHash: hashApiKey(rawApiKey),
      environment: 'sandbox',
      status: 'active',
      scopes,
      revokedAt: null,
    },
    create: {
      id: 'sandbox-developer-api-key',
      appId: app.id,
      name: 'Sandbox Developer Key',
      keyPrefix: getApiKeyPrefix(rawApiKey),
      keyHash: hashApiKey(rawApiKey),
      environment: 'sandbox',
      status: 'active',
      scopes,
    },
  });

  const agreementId = 'sandbox-infrastructure-agreement';
  const milestoneId = 'sandbox-infrastructure-milestone';
  await prisma.agreement.upsert({
    where: { id: agreementId },
    update: {
      status: 'proof_submitted',
      settlementStatus: 'FUNDED',
      fundingConfirmedAt: new Date('2026-08-21T12:00:00.000Z'),
    },
    create: {
      id: agreementId,
      appId: app.id,
      externalReferenceId: 'demo-ext-agreement-1',
      title: 'Sandbox API Agreement',
      description: 'Generic app-scoped agreement for infrastructure API testing.',
      clientExternalId: 'client-demo-1',
      workerExternalId: 'worker-demo-1',
      amount: '10000000000',
      currency: 'CKB',
      deadlineAt: new Date('2027-12-31T23:59:59.000Z'),
      disputeWindowSecs: 86400,
      releaseMode: 'milestone',
      disputeMode: 'app_managed',
      sourceType: 'api',
      metadataJson: JSON.stringify({ seeded: true, purpose: 'developer-console' }),
      status: 'proof_submitted',
      settlementStatus: 'FUNDED',
      fundingConfirmedAt: new Date('2026-08-21T12:00:00.000Z'),
    },
  });

  await prisma.milestone.upsert({
    where: { id: milestoneId },
    update: {
      status: 'proof_submitted',
    },
    create: {
      id: milestoneId,
      appId: app.id,
      agreementId,
      externalReferenceId: 'demo-ext-milestone-1',
      title: 'Sandbox Milestone',
      description: 'Submit proof and exercise the proof-review API.',
      amount: '10000000000',
      currency: 'CKB',
      sortOrder: 1,
      status: 'proof_submitted',
      dueDate: new Date('2027-12-15T23:59:59.000Z'),
    },
  });

  const escrowId = 'sandbox-mock-escrow';
  await prisma.escrow.upsert({
    where: { id_appId: { id: escrowId, appId: app.id } },
    update: {
      agreementId,
      milestoneId,
      amount: '10000000000',
      currency: 'CKB',
      rail: 'mock',
      network: 'sandbox',
      status: 'funded',
      lockAddress: `mock_escrow_${escrowId}`,
      lockTxHash: 'mock_seed_lock_tx',
      releaseTxHash: null,
      refundTxHash: null,
    },
    create: {
      id: escrowId,
      appId: app.id,
      agreementId,
      milestoneId,
      amount: '10000000000',
      currency: 'CKB',
      rail: 'mock',
      network: 'sandbox',
      status: 'funded',
      lockAddress: `mock_escrow_${escrowId}`,
      lockTxHash: 'mock_seed_lock_tx',
    },
  });

  await prisma.transaction.upsert({
    where: { id: 'sandbox-mock-lock-transaction' },
    update: {
      appId: app.id,
      agreementId,
      milestoneId,
      escrowId,
      type: 'lock',
      rail: 'mock',
      network: 'sandbox',
      status: 'confirmed',
      txHash: 'mock_seed_lock_tx',
      amount: '10000000000',
      currency: 'CKB',
      rawPayloadJson: JSON.stringify({ seeded: true, adapter: 'mock' }),
    },
    create: {
      id: 'sandbox-mock-lock-transaction',
      appId: app.id,
      agreementId,
      milestoneId,
      escrowId,
      type: 'lock',
      rail: 'mock',
      network: 'sandbox',
      status: 'confirmed',
      txHash: 'mock_seed_lock_tx',
      amount: '10000000000',
      currency: 'CKB',
      rawPayloadJson: JSON.stringify({ seeded: true, adapter: 'mock' }),
    },
  });

  const proofId = 'sandbox-proof-submission';
  const content = 'https://example.com/pactagent/sandbox-proof';
  await prisma.proof.upsert({
    where: { id: proofId },
    update: {
      appId: app.id,
      agreementId,
      milestoneId,
      submittedByExternalId: 'worker-demo-1',
      proofType: 'url',
      content,
      contentHash: proofHash({ type: 'url', content }),
      linksJson: JSON.stringify([content]),
      fileRefsJson: JSON.stringify([]),
      status: 'under_review',
    },
    create: {
      id: proofId,
      appId: app.id,
      agreementId,
      milestoneId,
      submittedByExternalId: 'worker-demo-1',
      proofType: 'url',
      content,
      contentHash: proofHash({ type: 'url', content }),
      linksJson: JSON.stringify([content]),
      fileRefsJson: JSON.stringify([]),
      status: 'under_review',
    },
  });

  await prisma.review.upsert({
    where: { id: 'sandbox-proof-review' },
    update: {
      appId: app.id,
      agreementId,
      milestoneId,
      proofSubmissionId: proofId,
      reviewerExternalId: 'reviewer-demo-1',
      decision: 'needs_changes',
      note: 'Seeded proof-review decision for console inspection.',
    },
    create: {
      id: 'sandbox-proof-review',
      appId: app.id,
      agreementId,
      milestoneId,
      proofSubmissionId: proofId,
      reviewerExternalId: 'reviewer-demo-1',
      decision: 'needs_changes',
      note: 'Seeded proof-review decision for console inspection.',
    },
  });

  await prisma.dispute.upsert({
    where: { id: 'sandbox-dispute' },
    update: {
      appId: app.id,
      agreementId,
      milestoneId,
      openedByExternalId: 'client-demo-1',
      reason: 'Seeded dispute for sandbox lifecycle inspection.',
      evidenceLinksJson: JSON.stringify(['https://example.com/pactagent/dispute-evidence']),
      status: 'open',
    },
    create: {
      id: 'sandbox-dispute',
      appId: app.id,
      agreementId,
      milestoneId,
      openedByExternalId: 'client-demo-1',
      reason: 'Seeded dispute for sandbox lifecycle inspection.',
      evidenceLinksJson: JSON.stringify(['https://example.com/pactagent/dispute-evidence']),
      status: 'open',
    },
  });

  const webhookSecret = process.env.SEED_SANDBOX_WEBHOOK_SECRET
    || 'whsec_seed_sandbox_demo_webhook_secret';
  const subscribedEvents = [
    'agreement.created', 'milestone.created', 'escrow.funded',
    'proof.submitted', 'proof.reviewed', 'dispute.opened',
  ];
  await prisma.webhookEndpoint.upsert({
    where: { id: 'sandbox-demo-webhook-endpoint' },
    update: {
      appId: app.id,
      url: 'https://example.com/pactagent/webhook',
      description: 'Sandbox webhook endpoint for signed-delivery testing.',
      subscribedEvents,
      secretHash: hashWebhookSecret(webhookSecret),
      secretCiphertext: encryptWebhookSecret(webhookSecret),
      status: 'active',
      deletedAt: null,
    },
    create: {
      id: 'sandbox-demo-webhook-endpoint',
      appId: app.id,
      url: 'https://example.com/pactagent/webhook',
      description: 'Sandbox webhook endpoint for signed-delivery testing.',
      subscribedEvents,
      secretHash: hashWebhookSecret(webhookSecret),
      secretCiphertext: encryptWebhookSecret(webhookSecret),
      status: 'active',
    },
  });

  const events = [
    ['sandbox-agreement-created-event', 'agreement.created'],
    ['sandbox-milestone-created-event', 'milestone.created'],
    ['sandbox-escrow-funded-event', 'escrow.funded'],
    ['sandbox-proof-submitted-event', 'proof.submitted'],
    ['sandbox-dispute-opened-event', 'dispute.opened'],
  ] as const;
  for (const [id, type] of events) {
    await prisma.event.upsert({
      where: { id },
      update: {
        appId: app.id,
        type,
        agreementId,
        milestoneId,
        escrowId: type.startsWith('escrow.') ? escrowId : null,
        proofSubmissionId: type.startsWith('proof.') ? proofId : null,
        disputeId: type.startsWith('dispute.') ? 'sandbox-dispute' : null,
        payloadJson: JSON.stringify({ agreementId, milestoneId, seeded: true }),
      },
      create: {
        id,
        appId: app.id,
        type,
        agreementId,
        milestoneId,
        escrowId: type.startsWith('escrow.') ? escrowId : null,
        proofSubmissionId: type.startsWith('proof.') ? proofId : null,
        disputeId: type.startsWith('dispute.') ? 'sandbox-dispute' : null,
        payloadJson: JSON.stringify({ agreementId, milestoneId, seeded: true }),
      },
    });
  }

  await prisma.auditLog.createMany({
    skipDuplicates: true,
    data: [{
      id: 'sandbox-seed-audit-log',
      appId: app.id,
      agreementId,
      actorType: 'system',
      actorId: 'seed',
      action: 'sandbox.fixture.created',
      resourceType: 'agreement',
      resourceId: agreementId,
      targetType: 'agreement',
      targetId: agreementId,
      afterJson: JSON.stringify({ agreementId, milestoneId, proofId, escrowId }),
    }],
  });

  console.log(JSON.stringify({
    appId: app.id,
    apiKey: rawApiKey,
    agreementId,
    milestoneId,
    proofId,
    escrowId,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
