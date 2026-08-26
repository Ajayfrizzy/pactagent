import { prisma, requireDatabaseUrl } from '../db';
import { config } from '../config';
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  getWebhookEncryptionKeyId,
} from '../modules/webhooks/webhook.signing';

requireDatabaseUrl();

async function main() {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      deletedAt: null,
    },
    select: {
      id: true,
      appId: true,
      url: true,
      secretCiphertext: true,
      encryptionKeyVersion: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  let rotatedCount = 0;
  let skippedCount = 0;

  for (const endpoint of endpoints) {
    if (!endpoint.secretCiphertext) {
      skippedCount += 1;
      continue;
    }
    const currentKeyId = getWebhookEncryptionKeyId(endpoint.secretCiphertext);
    if (currentKeyId === config.webhookActiveKeyId) {
      skippedCount += 1;
      continue;
    }
    const secret = decryptWebhookSecret(endpoint.secretCiphertext);
    const secretCiphertext = encryptWebhookSecret(secret);
    await prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        secretCiphertext,
        encryptionKeyVersion: getWebhookEncryptionKeyId(secretCiphertext),
      },
    });
    rotatedCount += 1;
  }

  process.stdout.write(JSON.stringify({
    activeKeyId: config.webhookActiveKeyId,
    rotatedCount,
    skippedCount,
  }, null, 2));
  process.stdout.write('\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
