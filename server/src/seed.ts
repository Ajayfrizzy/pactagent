import { createHash, randomUUID as uuid } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createRawApiKey, getApiKeyPrefix, hashApiKey } from './common/crypto/api-keys';
import { encryptWebhookSecret, hashWebhookSecret } from './modules/webhooks/webhook.signing';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

function createSeedProofHash(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

async function main() {
  console.log('[SEED] Seeding milestone demo data...');
  console.log('[SEED] Seeding infrastructure demo apps...');

  const sandboxAppId = 'sandbox-demo-app';
  const productionAppId = 'production-demo-app';

  const sandboxApp = await prisma.app.upsert({
    where: {
      id: sandboxAppId,
    },
    update: {
      name: 'Sandbox Demo App',
      slug: 'sandbox-demo-app',
      ownerUserId: 'seed-owner',
      environment: 'sandbox',
      status: 'active',
      defaultCurrency: 'CKB',
      defaultNetwork: 'sandbox',
    },
    create: {
      id: sandboxAppId,
      name: 'Sandbox Demo App',
      slug: 'sandbox-demo-app',
      ownerUserId: 'seed-owner',
      environment: 'sandbox',
      status: 'active',
      defaultCurrency: 'CKB',
      defaultNetwork: 'sandbox',
    },
  });

  await prisma.app.upsert({
    where: {
      id: productionAppId,
    },
    update: {
      name: 'Production Demo App',
      slug: 'production-demo-app',
      ownerUserId: 'seed-owner',
      environment: 'production',
      status: 'disabled',
      defaultCurrency: 'CKB',
      defaultNetwork: 'mainnet',
    },
    create: {
      id: productionAppId,
      name: 'Production Demo App',
      slug: 'production-demo-app',
      ownerUserId: 'seed-owner',
      environment: 'production',
      status: 'disabled',
      defaultCurrency: 'CKB',
      defaultNetwork: 'mainnet',
    },
  });

  const seedRawApiKey = process.env.SEED_SANDBOX_API_KEY || createRawApiKey('sandbox');
  await prisma.apiKey.upsert({
    where: {
      keyHash: hashApiKey(seedRawApiKey),
    },
    update: {
      appId: sandboxApp.id,
      name: 'Sandbox Limited Key',
      keyPrefix: getApiKeyPrefix(seedRawApiKey),
      environment: 'sandbox',
      status: 'active',
      scopes: ['apps:read', 'agreements:create', 'agreements:read', 'events:read'],
    },
    create: {
      id: 'sandbox-limited-api-key',
      appId: sandboxApp.id,
      name: 'Sandbox Limited Key',
      keyPrefix: getApiKeyPrefix(seedRawApiKey),
      keyHash: hashApiKey(seedRawApiKey),
      environment: 'sandbox',
      status: 'active',
      scopes: ['apps:read', 'agreements:create', 'agreements:read', 'events:read'],
    },
  });

  const seedFullRawApiKey = process.env.SEED_SANDBOX_FULL_API_KEY || createRawApiKey('sandbox');
  const seedFullScopes = [
    'apps:read',
    'agreements:create',
    'agreements:read',
    'agreements:update',
    'agreements:cancel',
    'milestones:create',
    'milestones:read',
    'escrows:create',
    'escrows:read',
    'escrows:fund',
    'escrows:release',
    'escrows:refund',
    'proofs:create',
    'proofs:read',
    'proofs:review',
    'disputes:create',
    'disputes:read',
    'disputes:resolve',
    'events:read',
    'webhooks:manage',
    'webhooks:read',
  ];

  await prisma.apiKey.upsert({
    where: {
      keyHash: hashApiKey(seedFullRawApiKey),
    },
    update: {
      appId: sandboxApp.id,
      name: 'Sandbox Full Workflow Key',
      keyPrefix: getApiKeyPrefix(seedFullRawApiKey),
      environment: 'sandbox',
      status: 'active',
      scopes: seedFullScopes,
    },
    create: {
      id: 'sandbox-full-workflow-api-key',
      appId: sandboxApp.id,
      name: 'Sandbox Full Workflow Key',
      keyPrefix: getApiKeyPrefix(seedFullRawApiKey),
      keyHash: hashApiKey(seedFullRawApiKey),
      environment: 'sandbox',
      status: 'active',
      scopes: seedFullScopes,
    },
  });

  await prisma.auditLog.upsert({
    where: {
      id: 'sandbox-demo-app-created-audit-log',
    },
    update: {
      appId: sandboxApp.id,
      actorType: 'system',
      actorId: 'seed',
      action: 'app.created',
      resourceType: 'app',
      resourceId: sandboxApp.id,
      targetType: 'app',
      targetId: sandboxApp.id,
      afterJson: JSON.stringify({
        id: sandboxApp.id,
        name: sandboxApp.name,
        environment: sandboxApp.environment,
      }),
    },
    create: {
      id: 'sandbox-demo-app-created-audit-log',
      appId: sandboxApp.id,
      actorType: 'system',
      actorId: 'seed',
      action: 'app.created',
      resourceType: 'app',
      resourceId: sandboxApp.id,
      targetType: 'app',
      targetId: sandboxApp.id,
      afterJson: JSON.stringify({
        id: sandboxApp.id,
        name: sandboxApp.name,
        environment: sandboxApp.environment,
      }),
    },
  });

  const seedWebhookSecret = process.env.SEED_SANDBOX_WEBHOOK_SECRET || 'whsec_seed_sandbox_demo_webhook_secret';
  const seedWebhookEvents = [
    'agreement.created',
    'escrow.funded',
    'proof.submitted',
    'proof.approved',
    'dispute.opened',
  ];

  await prisma.webhookEndpoint.upsert({
    where: {
      id: 'sandbox-demo-webhook-endpoint',
    },
    update: {
      appId: sandboxApp.id,
      ownerAddress: sandboxApp.id,
      label: 'Sandbox Demo Webhook',
      targetUrl: 'https://example.com/pactagent/webhook',
      url: 'https://example.com/pactagent/webhook',
      description: 'Safe test endpoint for sandbox webhook delivery examples.',
      eventTypesJson: JSON.stringify(seedWebhookEvents),
      subscribedEvents: seedWebhookEvents,
      signingSecret: hashWebhookSecret(seedWebhookSecret),
      secretHash: hashWebhookSecret(seedWebhookSecret),
      secretCiphertext: encryptWebhookSecret(seedWebhookSecret),
      status: 'active',
      isActive: true,
      deletedAt: null,
    },
    create: {
      id: 'sandbox-demo-webhook-endpoint',
      appId: sandboxApp.id,
      ownerAddress: sandboxApp.id,
      label: 'Sandbox Demo Webhook',
      targetUrl: 'https://example.com/pactagent/webhook',
      url: 'https://example.com/pactagent/webhook',
      description: 'Safe test endpoint for sandbox webhook delivery examples.',
      eventTypesJson: JSON.stringify(seedWebhookEvents),
      subscribedEvents: seedWebhookEvents,
      signingSecret: hashWebhookSecret(seedWebhookSecret),
      secretHash: hashWebhookSecret(seedWebhookSecret),
      secretCiphertext: encryptWebhookSecret(seedWebhookSecret),
      status: 'active',
      isActive: true,
    },
  });

  const infrastructureAgreementId = 'sandbox-infrastructure-agreement';
  const infrastructureMilestoneId = 'sandbox-infrastructure-milestone';

  await prisma.agreement.upsert({
    where: {
      id: infrastructureAgreementId,
    },
    update: {
      appId: sandboxApp.id,
      externalReferenceId: 'demo-ext-agreement-1',
      title: 'Sandbox API Agreement',
      description: 'Generic sandbox agreement created for infrastructure API testing.',
      clientExternalId: 'client-demo-1',
      workerExternalId: 'worker-demo-1',
      clientAddress: 'client-demo-1',
      workerAddress: 'worker-demo-1',
      amount: '10000000000',
      currency: 'CKB',
      deadlineAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      proofType: 'URL',
      reviewerMode: 'MANUAL',
      releaseMode: 'PARTIAL',
      infrastructureReleaseMode: 'milestone',
      disputeMode: 'app_managed',
      sourceType: 'api',
      sourceUrl: null,
      metadataJson: JSON.stringify({ seeded: true }),
      status: 'proof_submitted',
      settlementStatus: 'FUNDED',
      fundingConfirmedAt: new Date(),
    },
    create: {
      id: infrastructureAgreementId,
      appId: sandboxApp.id,
      externalReferenceId: 'demo-ext-agreement-1',
      title: 'Sandbox API Agreement',
      description: 'Generic sandbox agreement created for infrastructure API testing.',
      clientExternalId: 'client-demo-1',
      workerExternalId: 'worker-demo-1',
      clientAddress: 'client-demo-1',
      workerAddress: 'worker-demo-1',
      amount: '10000000000',
      currency: 'CKB',
      deadlineAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      proofType: 'URL',
      reviewerMode: 'MANUAL',
      releaseMode: 'PARTIAL',
      infrastructureReleaseMode: 'milestone',
      disputeMode: 'app_managed',
      sourceType: 'api',
      metadataJson: JSON.stringify({ seeded: true }),
      status: 'proof_submitted',
      settlementStatus: 'FUNDED',
      fundingConfirmedAt: new Date(),
    },
  });

  await prisma.milestone.upsert({
    where: {
      id: infrastructureMilestoneId,
    },
    update: {
      appId: sandboxApp.id,
      agreementId: infrastructureAgreementId,
      externalReferenceId: 'demo-ext-milestone-1',
      title: 'Sandbox Milestone',
      description: 'Generic sandbox milestone for infrastructure API testing.',
      amount: '10000000000',
      currency: 'CKB',
      sortOrder: 1,
      status: 'proof_submitted',
    },
    create: {
      id: infrastructureMilestoneId,
      appId: sandboxApp.id,
      agreementId: infrastructureAgreementId,
      externalReferenceId: 'demo-ext-milestone-1',
      title: 'Sandbox Milestone',
      description: 'Generic sandbox milestone for infrastructure API testing.',
      amount: '10000000000',
      currency: 'CKB',
      sortOrder: 1,
      status: 'proof_submitted',
    },
  });

  await prisma.event.upsert({
    where: {
      id: 'sandbox-agreement-created-event',
    },
    update: {
      appId: sandboxApp.id,
      type: 'agreement.created',
      agreementId: infrastructureAgreementId,
      payloadJson: JSON.stringify({
        agreementId: infrastructureAgreementId,
        seeded: true,
      }),
    },
    create: {
      id: 'sandbox-agreement-created-event',
      appId: sandboxApp.id,
      type: 'agreement.created',
      agreementId: infrastructureAgreementId,
      payloadJson: JSON.stringify({
        agreementId: infrastructureAgreementId,
        seeded: true,
      }),
    },
  });

  await prisma.event.upsert({
    where: {
      id: 'sandbox-milestone-created-event',
    },
    update: {
      appId: sandboxApp.id,
      type: 'milestone.created',
      agreementId: infrastructureAgreementId,
      milestoneId: infrastructureMilestoneId,
      payloadJson: JSON.stringify({
        agreementId: infrastructureAgreementId,
        milestoneId: infrastructureMilestoneId,
        seeded: true,
      }),
    },
    create: {
      id: 'sandbox-milestone-created-event',
      appId: sandboxApp.id,
      type: 'milestone.created',
      agreementId: infrastructureAgreementId,
      milestoneId: infrastructureMilestoneId,
      payloadJson: JSON.stringify({
        agreementId: infrastructureAgreementId,
        milestoneId: infrastructureMilestoneId,
        seeded: true,
      }),
    },
  });

  const infrastructureEscrowId = 'sandbox-mock-escrow';

  await prisma.escrow.upsert({
    where: {
      id_appId: {
        id: infrastructureEscrowId,
        appId: sandboxApp.id,
      },
    },
    update: {
      agreementId: infrastructureAgreementId,
      milestoneId: infrastructureMilestoneId,
      amount: '10000000000',
      currency: 'CKB',
      rail: 'mock',
      network: 'sandbox',
      status: 'funded',
      lockAddress: `mock_escrow_${infrastructureEscrowId}`,
      lockTxHash: 'mock_seed_lock_tx',
      releaseTxHash: null,
      refundTxHash: null,
    },
    create: {
      id: infrastructureEscrowId,
      appId: sandboxApp.id,
      agreementId: infrastructureAgreementId,
      milestoneId: infrastructureMilestoneId,
      amount: '10000000000',
      currency: 'CKB',
      rail: 'mock',
      network: 'sandbox',
      status: 'funded',
      lockAddress: `mock_escrow_${infrastructureEscrowId}`,
      lockTxHash: 'mock_seed_lock_tx',
    },
  });

  await prisma.transaction.upsert({
    where: {
      id: 'sandbox-mock-escrow-lock-transaction',
    },
    update: {
      appId: sandboxApp.id,
      agreementId: infrastructureAgreementId,
      milestoneId: infrastructureMilestoneId,
      escrowId: infrastructureEscrowId,
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
      id: 'sandbox-mock-escrow-lock-transaction',
      appId: sandboxApp.id,
      agreementId: infrastructureAgreementId,
      milestoneId: infrastructureMilestoneId,
      escrowId: infrastructureEscrowId,
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

  await prisma.event.upsert({
    where: {
      id: 'sandbox-escrow-created-event',
    },
    update: {
      appId: sandboxApp.id,
      type: 'escrow.created',
      agreementId: infrastructureAgreementId,
      milestoneId: infrastructureMilestoneId,
      escrowId: infrastructureEscrowId,
      payloadJson: JSON.stringify({
        agreementId: infrastructureAgreementId,
        milestoneId: infrastructureMilestoneId,
        escrowId: infrastructureEscrowId,
        seeded: true,
      }),
    },
    create: {
      id: 'sandbox-escrow-created-event',
      appId: sandboxApp.id,
      type: 'escrow.created',
      agreementId: infrastructureAgreementId,
      milestoneId: infrastructureMilestoneId,
      escrowId: infrastructureEscrowId,
      payloadJson: JSON.stringify({
        agreementId: infrastructureAgreementId,
        milestoneId: infrastructureMilestoneId,
        escrowId: infrastructureEscrowId,
        seeded: true,
      }),
    },
  });

  const infrastructureProofId = 'sandbox-proof-submission';
  const infrastructureProofContent = 'https://example.com/pactagent/sandbox-proof';
  const infrastructureProofLinks = [infrastructureProofContent];
  const infrastructureProofFileRefs: string[] = [];
  const infrastructureProofHash = createSeedProofHash({
    type: 'url',
    content: infrastructureProofContent,
    links: infrastructureProofLinks,
    fileRefs: infrastructureProofFileRefs,
  });

  await prisma.proof.upsert({
    where: {
      id: infrastructureProofId,
    },
    update: {
      appId: sandboxApp.id,
      agreementId: infrastructureAgreementId,
      milestoneId: infrastructureMilestoneId,
      submittedByExternalId: 'worker-demo-1',
      proofType: 'url',
      content: infrastructureProofContent,
      contentHash: infrastructureProofHash,
      linksJson: JSON.stringify(infrastructureProofLinks),
      fileRefsJson: JSON.stringify(infrastructureProofFileRefs),
      status: 'submitted',
      reviewStatus: 'UNREVIEWED',
    },
    create: {
      id: infrastructureProofId,
      appId: sandboxApp.id,
      agreementId: infrastructureAgreementId,
      milestoneId: infrastructureMilestoneId,
      submittedByExternalId: 'worker-demo-1',
      proofType: 'url',
      content: infrastructureProofContent,
      contentHash: infrastructureProofHash,
      linksJson: JSON.stringify(infrastructureProofLinks),
      fileRefsJson: JSON.stringify(infrastructureProofFileRefs),
      status: 'submitted',
      reviewStatus: 'UNREVIEWED',
    },
  });

  await prisma.event.upsert({
    where: {
      id: 'sandbox-proof-submitted-event',
    },
    update: {
      appId: sandboxApp.id,
      type: 'proof.submitted',
      agreementId: infrastructureAgreementId,
      milestoneId: infrastructureMilestoneId,
      proofSubmissionId: infrastructureProofId,
      payloadJson: JSON.stringify({
        agreementId: infrastructureAgreementId,
        milestoneId: infrastructureMilestoneId,
        proofSubmissionId: infrastructureProofId,
        seeded: true,
      }),
    },
    create: {
      id: 'sandbox-proof-submitted-event',
      appId: sandboxApp.id,
      type: 'proof.submitted',
      agreementId: infrastructureAgreementId,
      milestoneId: infrastructureMilestoneId,
      proofSubmissionId: infrastructureProofId,
      payloadJson: JSON.stringify({
        agreementId: infrastructureAgreementId,
        milestoneId: infrastructureMilestoneId,
        proofSubmissionId: infrastructureProofId,
        seeded: true,
      }),
    },
  });

  await prisma.auditLog.upsert({
    where: {
      id: 'sandbox-proof-submitted-audit-log',
    },
    update: {
      appId: sandboxApp.id,
      agreementId: infrastructureAgreementId,
      actorType: 'system',
      actorId: 'seed',
      action: 'proof.submitted',
      resourceType: 'proof',
      resourceId: infrastructureProofId,
      targetType: 'proof',
      targetId: infrastructureProofId,
      afterJson: JSON.stringify({
        id: infrastructureProofId,
        agreementId: infrastructureAgreementId,
        milestoneId: infrastructureMilestoneId,
      }),
    },
    create: {
      id: 'sandbox-proof-submitted-audit-log',
      appId: sandboxApp.id,
      agreementId: infrastructureAgreementId,
      actorType: 'system',
      actorId: 'seed',
      action: 'proof.submitted',
      resourceType: 'proof',
      resourceId: infrastructureProofId,
      targetType: 'proof',
      targetId: infrastructureProofId,
      afterJson: JSON.stringify({
        id: infrastructureProofId,
        agreementId: infrastructureAgreementId,
        milestoneId: infrastructureMilestoneId,
      }),
    },
  });

  const clientAddr =
    'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqt4z78ng4yutl5u6xpc4jmn98ueg9a90rc2duhtf';
  const workerAddr =
    'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwgx292hnvmn68xf779vmzrshpmm6epn4c0cgwga';
  const arbitratorAddr =
    'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq04g0372a9z33k20qx4wwvq85d9fllwuecamflgu';
  await prisma.user.upsert({
    where: { walletAddress: clientAddr },
    update: {},
    create: { id: uuid(), walletAddress: clientAddr, role: 'client' },
  });

  await prisma.user.upsert({
    where: { walletAddress: workerAddr },
    update: {},
    create: { id: uuid(), walletAddress: workerAddr, role: 'worker' },
  });

  await prisma.user.upsert({
    where: { walletAddress: arbitratorAddr },
    update: {},
    create: { id: uuid(), walletAddress: arbitratorAddr, role: 'both' },
  });

  const ag1Id = uuid();
  const ag1m1 = uuid();
  const ag1m2 = uuid();
  await prisma.agreement.create({
    data: {
      id: ag1Id,
      appId: sandboxApp.id,
      title: 'Landing Page Redesign',
      description: 'Redesign the landing page with milestone-based delivery and staged approval.',
      clientAddress: clientAddr,
      workerAddress: workerAddr,
      arbitratorAddress: arbitratorAddr,
      amount: '50000000000',
      deadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      disputeWindowSecs: 86400,
      proofType: 'URL',
      reviewerMode: 'AUTO',
      releaseMode: 'PARTIAL',
      payoutNetwork: 'CKB',
      escrowModel: 'TREASURY_BRIDGE',
      escrowAddress: clientAddr,
      agreementDigest: 'demo-agreement-digest-1',
      milestoneDigest: 'demo-milestone-digest-1',
      settlementStatus: 'FUNDED',
      fundingConfirmedAt: new Date(),
      status: 'FUNDED',
      ckbTxHashFund: '0xdemo1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
      milestones: {
        create: [
          {
            id: ag1m1,
            appId: sandboxApp.id,
            title: 'Wireframes and layout pass',
            description: 'Deliver homepage and key section wireframes.',
            amount: '20000000000',
            sortOrder: 1,
            status: 'ACTIVE',
          },
          {
            id: ag1m2,
            appId: sandboxApp.id,
            title: 'Final responsive implementation',
            description: 'Deliver polished responsive version and animations.',
            amount: '30000000000',
            sortOrder: 2,
            status: 'PENDING',
          },
        ],
      },
      settlements: {
        create: [
          {
            id: uuid(),
            direction: 'FUNDING',
            network: 'CKB',
            status: 'CONFIRMED',
            amount: '50000000000',
            txHash: '0xdemo1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
            confirmedAt: new Date(),
          },
        ],
      },
    },
  });

  const ag2Id = uuid();
  const ag2m1 = uuid();
  const ag2m2 = uuid();
  await prisma.agreement.create({
    data: {
      id: ag2Id,
      appId: sandboxApp.id,
      title: 'Smart Contract Audit',
      description: 'Audit delivered in two phases with an interim findings milestone.',
      clientAddress: clientAddr,
      workerAddress: workerAddr,
      arbitratorAddress: arbitratorAddr,
      amount: '100000000000',
      deadlineAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      disputeWindowSecs: 172800,
      proofType: 'TEXT',
      reviewerMode: 'HYBRID',
      releaseMode: 'PARTIAL',
      payoutNetwork: 'CKB',
      escrowModel: 'TREASURY_BRIDGE',
      escrowAddress: clientAddr,
      agreementDigest: 'demo-agreement-digest-2',
      milestoneDigest: 'demo-milestone-digest-2',
      settlementStatus: 'DISPUTE_LOCKED',
      fundingConfirmedAt: new Date(),
      status: 'DISPUTED',
      ckbTxHashFund: '0xdemo2234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
      milestones: {
        create: [
          {
            id: ag2m1,
            appId: sandboxApp.id,
            title: 'Threat model and scope review',
            description: 'Document attack surfaces and confirm audit scope.',
            amount: '40000000000',
            sortOrder: 1,
            status: 'DISPUTED',
          },
          {
            id: ag2m2,
            appId: sandboxApp.id,
            title: 'Final report and fixes review',
            description: 'Provide final report and verify remediation.',
            amount: '60000000000',
            sortOrder: 2,
            status: 'PENDING',
          },
        ],
      },
      settlements: {
        create: [
          {
            id: uuid(),
            direction: 'FUNDING',
            network: 'CKB',
            status: 'CONFIRMED',
            amount: '100000000000',
            txHash: '0xdemo2234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
            confirmedAt: new Date(),
          },
        ],
      },
    },
  });

  const ag3Id = uuid();
  const ag3m1 = uuid();
  const ag3m2 = uuid();
  const ag3m3 = uuid();
  await prisma.agreement.create({
    data: {
      id: ag3Id,
      appId: sandboxApp.id,
      title: 'API Integration Service',
      description: 'Build an API integration with staged releases on CKB.',
      clientAddress: clientAddr,
      workerAddress: workerAddr,
      arbitratorAddress: arbitratorAddr,
      amount: '30000000000',
      deadlineAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      disputeWindowSecs: 86400,
      proofType: 'URL',
      reviewerMode: 'AUTO',
      releaseMode: 'PARTIAL',
      payoutNetwork: 'CKB',
      escrowModel: 'TREASURY_BRIDGE',
      escrowAddress: clientAddr,
      agreementDigest: 'demo-agreement-digest-3',
      milestoneDigest: 'demo-milestone-digest-3',
      settlementStatus: 'UNFUNDED',
      status: 'DRAFT',
      milestones: {
        create: [
          {
            id: ag3m1,
            appId: sandboxApp.id,
            title: 'SDK authentication setup',
            description: 'Establish auth flow and shared client utilities.',
            amount: '10000000000',
            sortOrder: 1,
            status: 'PENDING',
          },
          {
            id: ag3m2,
            appId: sandboxApp.id,
            title: 'Core payment endpoints',
            description: 'Implement core integration endpoints.',
            amount: '10000000000',
            sortOrder: 2,
            status: 'PENDING',
          },
          {
            id: ag3m3,
            appId: sandboxApp.id,
            title: 'Webhooks and reconciliation',
            description: 'Finish callback handling and reconciliation logic.',
            amount: '10000000000',
            sortOrder: 3,
            status: 'PENDING',
          },
        ],
      },
    },
  });

  await prisma.proof.create({
    data: {
      id: uuid(),
      appId: sandboxApp.id,
      agreementId: ag2Id,
      milestoneId: ag2m1,
      proofType: 'TEXT',
      content: 'Initial findings document with identified risks and recommended mitigations.',
      contentHash: 'demo-proof-hash-1',
    },
  });

  await prisma.dispute.create({
    data: {
      id: uuid(),
      appId: sandboxApp.id,
      agreementId: ag2Id,
      milestoneId: ag2m1,
      openedBy: clientAddr,
      reason: 'The initial findings were too shallow for the agreed scope.',
      evidenceNotes: 'Expected more detail around access control and reentrancy checks.',
    },
  });

  await prisma.agentLog.createMany({
    data: [
      {
        id: uuid(),
        agreementId: ag1Id,
        level: 'INFO',
        eventType: 'AGREEMENT_CREATED',
        message: 'Agreement "Landing Page Redesign" created',
        metadataJson: JSON.stringify({ title: 'Landing Page Redesign', milestoneCount: 2 }),
      },
      {
        id: uuid(),
        agreementId: ag1Id,
        level: 'INFO',
        eventType: 'MILESTONE_ACTIVATED',
        message: 'Milestone 1 is now active: Wireframes and layout pass',
        metadataJson: JSON.stringify({ milestoneTitle: 'Wireframes and layout pass' }),
      },
      {
        id: uuid(),
        agreementId: ag2Id,
        level: 'WARN',
        eventType: 'DISPUTE_OPENED',
        message: 'Dispute opened on milestone 1 by client',
        metadataJson: JSON.stringify({ milestoneTitle: 'Threat model and scope review' }),
      },
    ],
  });

  console.log('[SEED] Created 3 milestone-based demo agreements');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
