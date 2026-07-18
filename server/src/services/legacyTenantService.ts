import type { Prisma } from '@prisma/client';
import { prisma } from '../db';

export const LEGACY_APP_ID = '00000000-0000-4000-8000-000000000001';

export function ensureLegacyApp(tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  return client.app.upsert({
    where: { id: LEGACY_APP_ID },
    update: {
      status: 'active',
    },
    create: {
      id: LEGACY_APP_ID,
      name: 'Legacy Wallet API',
      slug: 'legacy-wallet-api',
      ownerUserId: 'legacy-wallet-api',
      environment: 'production',
      status: 'active',
      defaultCurrency: 'CKB',
      defaultNetwork: 'legacy',
    },
  });
}
