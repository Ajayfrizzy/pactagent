import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { prisma } from '../db';

export const databaseIntegrationEnabled = process.env.RUN_DB_INTEGRATION_TESTS === 'true';

export function databaseIntegrationOptions() {
  return databaseIntegrationEnabled
    ? {}
    : { skip: 'Set RUN_DB_INTEGRATION_TESTS=true with a real PostgreSQL DATABASE_URL.' };
}

export function integrationRequest(params: {
  appId: string;
  path: string;
  body?: unknown;
  idempotencyKey: string;
}): Request {
  const headers = new Map([['idempotency-key', params.idempotencyKey]]);
  return {
    method: 'POST',
    originalUrl: params.path,
    body: params.body ?? {},
    ip: '127.0.0.1',
    requestId: `req_${randomUUID()}`,
    apiKey: {
      id: `key_${randomUUID()}`,
      appId: params.appId,
      name: 'phase2 integration key',
      keyPrefix: 'pa_test',
      environment: 'sandbox',
      scopes: [],
    },
    header(name: string) {
      return headers.get(name.toLowerCase()) ?? null;
    },
  } as unknown as Request;
}

export class IntegrationFixture {
  private readonly appIds: string[] = [];
  private readonly ownerId = `phase2-${randomUUID()}`;

  async connect() {
    await prisma.$connect();
  }

  async createApp(label: string) {
    const app = await prisma.app.create({
      data: {
        id: randomUUID(),
        ownerId: this.ownerId,
        name: label,
        slug: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 8)}`,
        environment: 'sandbox',
        status: 'active',
        defaultCurrency: 'CKB',
        defaultNetwork: 'sandbox',
      },
    });
    this.appIds.push(app.id);
    return app;
  }

  createAgreement(appId: string, params: { amount?: string; status?: string } = {}) {
    const status = params.status ?? 'draft';
    return prisma.agreement.create({
      data: {
        id: randomUUID(),
        appId,
        title: `Phase 2 ${randomUUID()}`,
        description: 'Phase 2 integration fixture',
        clientExternalId: 'client_fixture',
        workerExternalId: 'worker_fixture',
        amount: params.amount ?? '1000',
        currency: 'CKB',
        deadlineAt: new Date(Date.now() + 86_400_000),
        releaseMode: 'milestone',
        disputeMode: 'app_managed',
        settlementStatus: status === 'draft' ? 'UNFUNDED' : 'FUNDED',
        fundingConfirmedAt: status === 'draft' ? null : new Date(),
        status,
      },
    });
  }

  async cleanup() {
    if (this.appIds.length === 0) {
      await prisma.$disconnect();
      return;
    }
    const appFilter = { appId: { in: this.appIds } };
    await prisma.webhookDelivery.deleteMany({ where: appFilter });
    await prisma.webhookEndpoint.deleteMany({ where: appFilter });
    await prisma.event.deleteMany({ where: appFilter });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL pactagent.audit_maintenance = 'authorized'");
      await tx.auditLog.deleteMany({ where: appFilter });
    });
    await prisma.transaction.deleteMany({ where: appFilter });
    await prisma.review.deleteMany({ where: appFilter });
    await prisma.proof.deleteMany({ where: appFilter });
    await prisma.dispute.deleteMany({ where: appFilter });
    await prisma.escrow.deleteMany({ where: appFilter });
    await prisma.agreement.updateMany({
      where: appFilter,
      data: { status: 'draft', settlementStatus: 'UNFUNDED', fundingConfirmedAt: null },
    });
    await prisma.milestone.deleteMany({ where: appFilter });
    await prisma.idempotencyKey.deleteMany({ where: appFilter });
    await prisma.agentJob.deleteMany({ where: appFilter });
    await prisma.agreement.deleteMany({ where: appFilter });
    await prisma.apiKey.deleteMany({ where: appFilter });
    await prisma.app.deleteMany({ where: { id: { in: this.appIds } } });
    await prisma.$disconnect();
  }
}
