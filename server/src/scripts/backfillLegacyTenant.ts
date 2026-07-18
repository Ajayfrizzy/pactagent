import { createHash } from 'crypto';
import { prisma } from '../db';
import { ensureLegacyApp, LEGACY_APP_ID } from '../services/legacyTenantService';

function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

function looksHashed(value: string) {
  return /^[a-f0-9]{64}$/i.test(value);
}

async function main() {
  await ensureLegacyApp();

  const [agreements, milestones, proofs, disputes, deliveries] = await prisma.$transaction([
    prisma.$executeRaw`UPDATE "Agreement" SET "appId" = ${LEGACY_APP_ID} WHERE "appId" IS NULL`,
    prisma.$executeRaw`UPDATE "Milestone" SET "appId" = ${LEGACY_APP_ID} WHERE "appId" IS NULL`,
    prisma.$executeRaw`UPDATE "Proof" SET "appId" = ${LEGACY_APP_ID} WHERE "appId" IS NULL`,
    prisma.$executeRaw`UPDATE "Dispute" SET "appId" = ${LEGACY_APP_ID} WHERE "appId" IS NULL`,
    prisma.$executeRaw`
      UPDATE "WebhookDelivery"
      SET
        "appId" = ${LEGACY_APP_ID},
        "status" = 'FAILED',
        "lastError" = 'Legacy webhook deliveries were disabled during tenant backfill.',
        "nextRetryAt" = NULL
      WHERE "appId" IS NULL
    `,
  ]);

  const legacyEndpoints = await prisma.webhookEndpoint.findMany({
    where: {
      OR: [
        { appId: null },
        { secretHash: null },
      ],
    },
  });

  for (const endpoint of legacyEndpoints) {
    const secretHash = looksHashed(endpoint.signingSecret)
      ? endpoint.signingSecret
      : hashSecret(endpoint.signingSecret);

    await prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        appId: endpoint.appId ?? LEGACY_APP_ID,
        signingSecret: secretHash,
        secretHash,
        secretCiphertext: null,
        isActive: false,
        status: 'disabled',
        deletedAt: endpoint.deletedAt ?? new Date(),
      },
    });
  }

  console.log(JSON.stringify({
    legacyAppId: LEGACY_APP_ID,
    backfilled: {
      agreements,
      milestones,
      proofs,
      disputes,
      webhookDeliveries: deliveries,
      webhookEndpointsDisabled: legacyEndpoints.length,
    },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
