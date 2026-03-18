import { PrismaClient } from '@prisma/client';
import { v4 as uuid } from 'uuid';

const prisma = new PrismaClient();

async function main() {
  console.log('[SEED] Seeding milestone demo data...');

  const clientAddr =
    'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqt4z78ng4yutl5u6xpc4jmn98ueg9a90rc2duhtf';
  const workerAddr =
    'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwgx292hnvmn68xf779vmzrshpmm6epn4c0cgwga';
  const workerFiberPubkey =
    '020202020202020202020202020202020202020202020202020202020202020202';

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

  const ag1Id = uuid();
  const ag1m1 = uuid();
  const ag1m2 = uuid();
  await prisma.agreement.create({
    data: {
      id: ag1Id,
      title: 'Landing Page Redesign',
      description: 'Redesign the landing page with milestone-based delivery and staged approval.',
      clientAddress: clientAddr,
      workerAddress: workerAddr,
      amount: '50000000000',
      deadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      disputeWindowSecs: 86400,
      proofType: 'URL',
      reviewerMode: 'AUTO',
      releaseMode: 'PARTIAL',
      payoutNetwork: 'CKB',
      status: 'FUNDED',
      ckbTxHashFund: '0xdemo1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
      milestones: {
        create: [
          {
            id: ag1m1,
            title: 'Wireframes and layout pass',
            description: 'Deliver homepage and key section wireframes.',
            amount: '20000000000',
            sortOrder: 1,
            status: 'ACTIVE',
          },
          {
            id: ag1m2,
            title: 'Final responsive implementation',
            description: 'Deliver polished responsive version and animations.',
            amount: '30000000000',
            sortOrder: 2,
            status: 'PENDING',
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
      title: 'Smart Contract Audit',
      description: 'Audit delivered in two phases with an interim findings milestone.',
      clientAddress: clientAddr,
      workerAddress: workerAddr,
      amount: '100000000000',
      deadlineAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      disputeWindowSecs: 172800,
      proofType: 'TEXT',
      reviewerMode: 'HYBRID',
      releaseMode: 'PARTIAL',
      payoutNetwork: 'CKB',
      status: 'DISPUTED',
      ckbTxHashFund: '0xdemo2234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
      milestones: {
        create: [
          {
            id: ag2m1,
            title: 'Threat model and scope review',
            description: 'Document attack surfaces and confirm audit scope.',
            amount: '40000000000',
            sortOrder: 1,
            status: 'DISPUTED',
          },
          {
            id: ag2m2,
            title: 'Final report and fixes review',
            description: 'Provide final report and verify remediation.',
            amount: '60000000000',
            sortOrder: 2,
            status: 'PENDING',
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
      title: 'API Integration Service',
      description: 'Build an API integration with staged releases through Fiber.',
      clientAddress: clientAddr,
      workerAddress: workerAddr,
      workerFiberPubkey,
      amount: '30000000000',
      deadlineAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      disputeWindowSecs: 86400,
      proofType: 'URL',
      reviewerMode: 'AUTO',
      releaseMode: 'PARTIAL',
      payoutNetwork: 'FIBER',
      status: 'DRAFT',
      milestones: {
        create: [
          {
            id: ag3m1,
            title: 'SDK authentication setup',
            description: 'Establish auth flow and shared client utilities.',
            amount: '10000000000',
            sortOrder: 1,
            status: 'PENDING',
          },
          {
            id: ag3m2,
            title: 'Core payment endpoints',
            description: 'Implement core integration endpoints.',
            amount: '10000000000',
            sortOrder: 2,
            status: 'PENDING',
          },
          {
            id: ag3m3,
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
