import assert from 'assert/strict';
import { randomUUID } from 'crypto';
import test, { after, before, describe } from 'node:test';
import type { Request } from 'express';
import { prisma } from '../db';
import { AppError } from '../common/errors/app-error';
import { createAgreementForApp, getAgreementForApp } from './agreements/agreement.service';
import { releaseEscrow, refundEscrow } from './escrows/escrow.service';
import { assertWebhookUrlAllowed, fetchWebhookUrl, resetWebhookSecurityTestHooks, setWebhookSecurityTestHooks } from './webhooks/webhook.security';
import { createInfrastructureAuditLog } from './audit-logs/audit-log.repository';
import { claimAvailableJobs, completeJob, enqueueJob, releaseStaleLocks, renewJobLease } from '../services/jobQueueService';
import { getAppEvent, listAppEvents } from './events/event.service';
import { listAppTransactions } from './transactions/transaction.service';
import http from 'node:http';
import { createApp } from '../app';
import { getApiKeyPrefix, hashApiKey } from '../common/crypto/api-keys';
import { config } from '../config';
import {
  createWebhookEndpointForApp,
  updateWebhookEndpointForApp,
} from './webhooks/webhook.service';

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const ownerId = `integration-${randomUUID()}`;
const createdAppIds: string[] = [];
const createdWorkerIds: string[] = [];

function skipUnlessEnabled() {
  if (!shouldRun) {
    return { skip: 'Set RUN_DB_INTEGRATION_TESTS=true with a real DATABASE_URL to run database integration tests.' };
  }

  return {};
}

function requestStub(params: {
  method?: string;
  path?: string;
  body?: unknown;
  idempotencyKey?: string;
  apiKeyId?: string;
  appId?: string;
}): Request {
  const headers = new Map<string, string>();
  if (params.idempotencyKey) {
    headers.set('idempotency-key', params.idempotencyKey);
  }

  return {
    method: params.method ?? 'POST',
    originalUrl: params.path ?? '/v1/test',
    body: params.body ?? {},
    ip: '127.0.0.1',
    requestId: `req_${randomUUID()}`,
    apiKey: params.appId
      ? {
          id: params.apiKeyId ?? `key_${randomUUID()}`,
          appId: params.appId,
          name: 'integration key',
          keyPrefix: 'pa_test',
          environment: 'sandbox',
          scopes: [],
        }
      : undefined,
    header(name: string) {
      return headers.get(name.toLowerCase()) ?? null;
    },
  } as unknown as Request;
}

async function createIntegrationApp(name: string) {
  const app = await prisma.app.create({
    data: {
      id: randomUUID(),
      ownerId,
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 8)}`,
      environment: 'sandbox',
      status: 'active',
      defaultCurrency: 'CKB',
      defaultNetwork: 'sandbox',
    },
  });
  createdAppIds.push(app.id);
  return app;
}

async function seedAgreement(appId: string, params?: {
  status?: string;
  amount?: string;
}) {
  return prisma.agreement.create({
    data: {
      id: randomUUID(),
      appId,
      title: `Integration Agreement ${randomUUID()}`,
      description: 'Integration test agreement',
      clientExternalId: 'client_external',
      workerExternalId: 'worker_external',
      amount: params?.amount ?? '1000',
      currency: 'CKB',
      deadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      releaseMode: 'milestone',
      disputeMode: 'app_managed',
      settlementStatus: params?.status && params.status !== 'draft' ? 'FUNDED' : 'UNFUNDED',
      status: params?.status ?? 'draft',
    },
  });
}

async function markAgreementFunded(agreementId: string, status = 'approved') {
  return prisma.agreement.update({
    where: { id: agreementId },
    data: { status, settlementStatus: 'FUNDED', fundingConfirmedAt: new Date() },
  });
}

describe('real database infrastructure safety', skipUnlessEnabled(), () => {
  before(async () => {
    await prisma.$connect();
  });

  after(async () => {
    if (createdWorkerIds.length) {
      await prisma.workerHeartbeat.deleteMany({ where: { id: { in: createdWorkerIds } } });
    }
    if (createdAppIds.length) {
      await prisma.webhookDelivery.deleteMany({ where: { appId: { in: createdAppIds } } });
      await prisma.webhookEndpoint.deleteMany({ where: { appId: { in: createdAppIds } } });
      await prisma.event.deleteMany({ where: { appId: { in: createdAppIds } } });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL pactagent.audit_maintenance = 'authorized'");
        await tx.auditLog.deleteMany({ where: { appId: { in: createdAppIds } } });
      });
      await prisma.transaction.deleteMany({ where: { appId: { in: createdAppIds } } });
      await prisma.review.deleteMany({ where: { appId: { in: createdAppIds } } });
      await prisma.proof.deleteMany({ where: { appId: { in: createdAppIds } } });
      await prisma.dispute.deleteMany({ where: { appId: { in: createdAppIds } } });
      await prisma.escrow.deleteMany({ where: { appId: { in: createdAppIds } } });
      await prisma.agreement.updateMany({
        where: { appId: { in: createdAppIds } },
        data: {
          status: 'draft',
          settlementStatus: 'UNFUNDED',
          fundingConfirmedAt: null,
        },
      });
      await prisma.milestone.deleteMany({ where: { appId: { in: createdAppIds } } });
      await prisma.idempotencyKey.deleteMany({ where: { appId: { in: createdAppIds } } });
      await prisma.agentJob.deleteMany({ where: { appId: { in: createdAppIds } } });
      await prisma.agreement.deleteMany({ where: { appId: { in: createdAppIds } } });
      await prisma.apiKey.deleteMany({ where: { appId: { in: createdAppIds } } });
      await prisma.app.deleteMany({
        where: {
          id: { in: createdAppIds },
        },
      });
    }
    await prisma.$disconnect();
    resetWebhookSecurityTestHooks();
  });

  test('cross-app isolation prevents App A from reading App B agreement', async () => {
    const appA = await createIntegrationApp('Isolation A');
    const appB = await createIntegrationApp('Isolation B');
    const agreement = await seedAgreement(appB.id);

    await assert.rejects(
      () => getAgreementForApp(appA.id, agreement.id),
      (error) => error instanceof AppError && error.code === 'agreement_not_found',
    );

    const fetched = await getAgreementForApp(appB.id, agreement.id);
    assert.equal(fetched.id, agreement.id);
    assert.equal(fetched.appId, appB.id);
  });

  test('current webhook creation stores complete signing material and incomplete endpoints cannot be activated', async (t) => {
    const app = await createIntegrationApp('Webhook Secret Migration Safety');
    const originalEncryptionKey = config.webhookSecretEncryptionKey;
    config.webhookSecretEncryptionKey = 'integration-webhook-encryption-key';
    t.after(() => {
      resetWebhookSecurityTestHooks();
      config.webhookSecretEncryptionKey = originalEncryptionKey;
    });
    setWebhookSecurityTestHooks({
      lookupAll: async () => [{ address: '203.0.113.10' }],
    });

    const created = await createWebhookEndpointForApp(
      requestStub({ appId: app.id }),
      app,
      {
        url: 'https://webhooks.example.com/pactagent',
        description: 'Post-migration endpoint',
        subscribedEvents: ['agreement.created'],
      },
    );

    assert.equal(created.status, 'active');
    assert.equal(created.requiresSecretRotation, false);
    assert.match(created.secret, /^whsec_/);

    const stored = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: created.id } });
    assert.ok(stored.secretHash);
    assert.ok(stored.secretCiphertext);
    assert.ok(stored.encryptionKeyVersion);

    const migrated = await prisma.webhookEndpoint.create({
      data: {
        id: randomUUID(),
        appId: app.id,
        url: 'https://webhooks.example.com/migrated',
        subscribedEvents: ['agreement.created'],
        status: 'disabled',
      },
    });

    await assert.rejects(
      () => updateWebhookEndpointForApp(
        requestStub({ appId: app.id }),
        app,
        migrated.id,
        { status: 'active' },
      ),
      (error) => error instanceof AppError && error.code === 'webhook_secret_rotation_required',
    );
    await assert.rejects(() => prisma.webhookEndpoint.update({
      where: { id: migrated.id },
      data: { status: 'active' },
    }));
  });

  test('database constraints reject a cross-app milestone relationship', async () => {
    const appA = await createIntegrationApp('Constraint A');
    const appB = await createIntegrationApp('Constraint B');
    const agreement = await seedAgreement(appB.id);

    await assert.rejects(() => prisma.milestone.create({
      data: {
        id: randomUUID(),
        appId: appA.id,
        agreementId: agreement.id,
        title: 'Invalid tenant milestone',
        description: 'Must be rejected by PostgreSQL',
        amount: '1000',
        currency: 'CKB',
        sortOrder: 1,
        status: 'pending',
      },
    }));
  });

  test('tenant-scoped event and transaction reads cannot escape to another app', async () => {
    const appA = await createIntegrationApp('Read Isolation A');
    const appB = await createIntegrationApp('Read Isolation B');
    const agreement = await seedAgreement(appB.id);
    const event = await prisma.event.create({
      data: {
        id: randomUUID(), appId: appB.id, agreementId: agreement.id,
        type: 'agreement.created', payloadJson: '{}',
      },
    });
    await prisma.transaction.create({
      data: {
        id: randomUUID(), appId: appB.id, agreementId: agreement.id, type: 'lock',
        rail: 'mock', network: 'sandbox', status: 'confirmed', amount: '1000', currency: 'CKB',
      },
    });

    await assert.rejects(
      () => getAppEvent(appA.id, event.id),
      (error) => error instanceof AppError && error.code === 'event_not_found',
    );
    assert.equal((await listAppEvents(appA.id, { limit: 20 })).data.length, 0);
    assert.equal((await listAppTransactions(appA.id, { limit: 20 })).data.length, 0);
  });

  test('authenticated API requests return not found for another tenant event', async (t) => {
    const appA = await createIntegrationApp('HTTP Isolation A');
    const appB = await createIntegrationApp('HTTP Isolation B');
    const rawKey = `pa_test_${randomUUID().replace(/-/g, '')}`;
    await prisma.apiKey.create({
      data: {
        id: randomUUID(), appId: appA.id, name: 'HTTP test key',
        keyPrefix: getApiKeyPrefix(rawKey), keyHash: hashApiKey(rawKey),
        environment: 'sandbox', status: 'active', scopes: ['events:read'],
      },
    });
    const event = await prisma.event.create({
      data: { id: randomUUID(), appId: appB.id, type: 'private.event', payloadJson: '{}' },
    });
    const server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    const response = await fetch(`http://127.0.0.1:${address.port}/v1/events/${event.id}`, {
      headers: { 'x-api-key': rawKey },
    });
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(response.status, 404);
    assert.equal(body.error?.code, 'event_not_found');
  });

  test('PostgreSQL rejects every cross-tenant infrastructure parent reference', async () => {
    const appA = await createIntegrationApp('Constraint Matrix A');
    const appB = await createIntegrationApp('Constraint Matrix B');
    const agreement = await seedAgreement(appB.id);
    const milestone = await prisma.milestone.create({
      data: {
        id: randomUUID(), appId: appB.id, agreementId: agreement.id,
        title: 'B milestone', description: 'Tenant B', amount: '1000', currency: 'CKB', sortOrder: 1,
      },
    });
    const proof = await prisma.proof.create({
      data: {
        id: randomUUID(), appId: appB.id, agreementId: agreement.id, milestoneId: milestone.id,
        proofType: 'TEXT', content: 'proof', contentHash: randomUUID(),
      },
    });
    const escrow = await prisma.escrow.create({
      data: {
        id: randomUUID(), appId: appB.id, agreementId: agreement.id, milestoneId: milestone.id,
        amount: '1000', currency: 'CKB', rail: 'mock', network: 'sandbox',
      },
    });
    const dispute = await prisma.dispute.create({
      data: {
        id: randomUUID(), appId: appB.id, agreementId: agreement.id, milestoneId: milestone.id,
        openedByExternalId: 'tenant-b', reason: 'constraint fixture',
      },
    });

    const invalidWrites = [
      () => prisma.proof.create({ data: {
        id: randomUUID(), appId: appA.id, agreementId: agreement.id, milestoneId: milestone.id,
        proofType: 'TEXT', content: 'invalid', contentHash: randomUUID(),
      } }),
      () => prisma.review.create({ data: {
        id: randomUUID(), appId: appA.id, agreementId: agreement.id, milestoneId: milestone.id,
        proofSubmissionId: proof.id, reviewerExternalId: 'reviewer', decision: 'approved',
      } }),
      () => prisma.escrow.create({ data: {
        id: randomUUID(), appId: appA.id, agreementId: agreement.id, milestoneId: milestone.id,
        amount: '1000', currency: 'CKB', rail: 'mock', network: 'sandbox',
      } }),
      () => prisma.transaction.create({ data: {
        id: randomUUID(), appId: appA.id, agreementId: agreement.id, milestoneId: milestone.id,
        escrowId: escrow.id, type: 'lock', rail: 'mock', network: 'sandbox', amount: '1000', currency: 'CKB',
      } }),
      () => prisma.dispute.create({ data: {
        id: randomUUID(), appId: appA.id, agreementId: agreement.id, milestoneId: milestone.id,
        openedByExternalId: 'tenant-a', reason: 'invalid tenant',
      } }),
      () => prisma.event.create({ data: {
        id: randomUUID(), appId: appA.id, agreementId: agreement.id, milestoneId: milestone.id,
        escrowId: escrow.id, proofSubmissionId: proof.id, disputeId: dispute.id,
        type: 'invalid.cross_tenant', payloadJson: '{}',
      } }),
    ];

    for (const write of invalidWrites) {
      await assert.rejects(write);
    }
  });

  test('tenant A cannot access any tenant B infrastructure resource over HTTP', async (t) => {
    const appA = await createIntegrationApp('HTTP Matrix A');
    const appB = await createIntegrationApp('HTTP Matrix B');
    const rawKey = `pa_test_${randomUUID().replace(/-/g, '')}`;
    await prisma.apiKey.create({
      data: {
        id: randomUUID(), appId: appA.id, name: 'HTTP matrix key',
        keyPrefix: getApiKeyPrefix(rawKey), keyHash: hashApiKey(rawKey), environment: 'sandbox', status: 'active',
        scopes: [
          'agreements:read', 'milestones:read', 'proofs:read', 'escrows:read',
          'disputes:read', 'events:read', 'webhooks:read', 'apps:read', 'admin:read',
        ],
      },
    });
    const agreement = await seedAgreement(appB.id);
    const milestone = await prisma.milestone.create({ data: {
      id: randomUUID(), appId: appB.id, agreementId: agreement.id,
      title: 'Private milestone', description: 'Tenant B only', amount: '1000', currency: 'CKB', sortOrder: 1,
    } });
    const proof = await prisma.proof.create({ data: {
      id: randomUUID(), appId: appB.id, agreementId: agreement.id, milestoneId: milestone.id,
      proofType: 'TEXT', content: 'private', contentHash: randomUUID(),
    } });
    const escrow = await prisma.escrow.create({ data: {
      id: randomUUID(), appId: appB.id, agreementId: agreement.id, milestoneId: milestone.id,
      amount: '1000', currency: 'CKB', rail: 'mock', network: 'sandbox',
    } });
    const event = await prisma.event.create({ data: {
      id: randomUUID(), appId: appB.id, agreementId: agreement.id, milestoneId: milestone.id,
      escrowId: escrow.id, proofSubmissionId: proof.id, type: 'private.event', payloadJson: '{}',
    } });
    const dispute = await prisma.dispute.create({ data: {
      id: randomUUID(), appId: appB.id, agreementId: agreement.id, milestoneId: milestone.id,
      openedByExternalId: 'tenant-b', reason: 'private dispute',
    } });
    const endpoint = await prisma.webhookEndpoint.create({ data: {
      id: randomUUID(), appId: appB.id, url: 'https://example.com/hook',
      subscribedEvents: [], status: 'disabled',
    } });
    const delivery = await prisma.webhookDelivery.create({ data: {
      id: randomUUID(), appId: appB.id, endpointId: endpoint.id, eventId: event.id,
      agreementId: agreement.id, eventType: event.type, payloadJson: '{}', payloadHash: randomUUID(),
    } });
    await prisma.review.create({ data: {
      id: randomUUID(), appId: appB.id, agreementId: agreement.id, milestoneId: milestone.id,
      proofSubmissionId: proof.id, reviewerExternalId: 'tenant-b-reviewer', decision: 'approved',
    } });
    await prisma.transaction.create({ data: {
      id: randomUUID(), appId: appB.id, agreementId: agreement.id, milestoneId: milestone.id,
      escrowId: escrow.id, type: 'lock', rail: 'mock', network: 'sandbox', amount: '1000', currency: 'CKB',
    } });
    await createInfrastructureAuditLog({
      appId: appB.id, agreementId: agreement.id, actorType: 'system',
      action: 'private.audit', targetType: 'agreement', targetId: agreement.id,
    });

    const server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { 'x-api-key': rawKey };

    for (const path of [
      `/v1/agreements/${agreement.id}`,
      `/v1/milestones/${milestone.id}`,
      `/v1/proofs/${proof.id}`,
      `/v1/escrows/${escrow.id}`,
      `/v1/disputes/${dispute.id}`,
      `/v1/events/${event.id}`,
      `/v1/webhook-endpoints/${endpoint.id}`,
      `/v1/webhook-deliveries/${delivery.id}`,
    ]) {
      const response = await fetch(`${base}${path}`, { headers });
      assert.equal(response.status, 404, path);
    }

    for (const path of [
      '/v1/agreements', '/v1/milestones', '/v1/proofs', '/v1/escrows',
      '/v1/transactions', '/v1/reviews', '/v1/disputes', '/v1/events', '/v1/webhook-endpoints',
      '/v1/webhook-deliveries', '/v1/audit-logs',
    ]) {
      const response = await fetch(`${base}${path}`, { headers });
      assert.equal(response.status, 200, path);
      const body = await response.json() as { data?: Array<{ id?: string }> };
      assert.deepEqual(body.data, [], path);
    }
  });

  test('worker heartbeat lifecycle is persisted for readiness checks', async () => {
    const workerId = `integration-worker-${randomUUID()}`;
    createdWorkerIds.push(workerId);
    await prisma.workerHeartbeat.create({
      data: {
        id: workerId,
        hostname: 'integration-host',
        processId: process.pid,
        version: 'integration',
        status: 'running',
      },
    });
    const updated = await prisma.workerHeartbeat.update({
      where: { id: workerId },
      data: { cyclesSucceeded: { increment: 1 }, lastCycleAt: new Date(), lastCycleDurationMs: 25 },
    });
    assert.equal(updated.status, 'running');
    assert.equal(updated.cyclesSucceeded, 1);
    assert.equal(updated.lastCycleDurationMs, 25);
  });

  test('a stale job lock from a crashed worker is released and reclaimed once', async () => {
    const app = await createIntegrationApp('Worker Recovery App');
    const agreement = await seedAgreement(app.id);
    const job = await enqueueJob({
      appId: app.id,
      agreementId: agreement.id,
      kind: 'DELIVER_WEBHOOK',
      payload: { deliveryId: randomUUID() },
    });
    await prisma.agentJob.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING', lockedBy: 'crashed-worker',
        lockedAt: new Date(Date.now() - 10 * 60_000),
        leaseExpiresAt: new Date(Date.now() - 5 * 60_000), attempts: 1,
      },
    });

    assert.equal((await releaseStaleLocks(5 * 60_000)).count, 1);
    const [first, second] = await Promise.all([
      claimAvailableJobs('replacement-a', ['webhook'], 10, 60_000),
      claimAvailableJobs('replacement-b', ['webhook'], 10, 60_000),
    ]);
    assert.equal(first.length + second.length, 1);
    const recovered = [...first, ...second][0];
    assert.equal(recovered.id, job.id);
    assert.match(recovered.lastError ?? '', /Recovered stale worker lock/);
  });

  test('atomic SKIP LOCKED claims partition jobs across concurrent workers', async () => {
    const app = await createIntegrationApp('Concurrent Claim App');
    const agreement = await seedAgreement(app.id);
    const jobs = await Promise.all(Array.from({ length: 12 }, (_, index) => enqueueJob({
      appId: app.id,
      agreementId: agreement.id,
      kind: 'DELIVER_WEBHOOK',
      payload: { deliveryId: randomUUID() },
      dedupeKey: `concurrent-${index}-${randomUUID()}`,
      availableAt: new Date(0),
    })));
    const claims = await Promise.all([
      claimAvailableJobs('claim-worker-a', ['webhook'], 6, 60_000),
      claimAvailableJobs('claim-worker-b', ['webhook'], 6, 60_000),
    ]);
    const claimed = claims.flat().filter((job) => jobs.some((created) => created.id === job.id));
    assert.equal(claimed.length, 12);
    assert.equal(new Set(claimed.map((job) => job.id)).size, 12);
    assert.ok(claimed.every((job) => job.status === 'RUNNING' && job.leaseExpiresAt));
  });

  test('only the lease owner can renew or complete a claimed job', async () => {
    const app = await createIntegrationApp('Lease Ownership App');
    const agreement = await seedAgreement(app.id);
    const queued = await enqueueJob({
      appId: app.id,
      agreementId: agreement.id,
      kind: 'DELIVER_WEBHOOK',
      payload: { deliveryId: randomUUID() },
      dedupeKey: randomUUID(),
      availableAt: new Date(0),
    });
    const [claimed] = await claimAvailableJobs('lease-owner', ['webhook'], 1, 60_000);
    assert.equal(claimed.id, queued.id);
    await assert.rejects(() => renewJobLease(claimed.id, 'other-worker', 60_000));
    await assert.rejects(() => completeJob(claimed.id, 'other-worker'));
    const renewedUntil = await renewJobLease(claimed.id, 'lease-owner', 60_000);
    assert.ok(renewedUntil > new Date());
    await completeJob(claimed.id, 'lease-owner');
    const completed = await prisma.agentJob.findUniqueOrThrow({ where: { id: claimed.id } });
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.leaseExpiresAt, null);
  });

  test('audit ledger hashes new rows and rejects mutation', async () => {
    const app = await createIntegrationApp('Immutable Audit App');
    const row = await createInfrastructureAuditLog({
      appId: app.id,
      actorType: 'system',
      action: 'integration.audit.created',
      targetType: 'app',
      targetId: app.id,
    });
    assert.match(row.recordHash || '', /^[a-f0-9]{64}$/);
    await assert.rejects(() => prisma.auditLog.update({
      where: { id: row.id },
      data: { action: 'integration.audit.tampered' },
    }));
  });

  test('financial and lifecycle constraints reject invalid persisted state', async () => {
    const app = await createIntegrationApp('Financial Constraints App');
    const agreement = await seedAgreement(app.id);
    const milestone = await prisma.milestone.create({ data: {
      id: randomUUID(), appId: app.id, agreementId: agreement.id,
      title: 'Constraint milestone', description: 'Constraint checks', amount: '1000', currency: 'CKB', sortOrder: 1,
    } });
    const escrow = await prisma.escrow.create({ data: {
      id: randomUUID(), appId: app.id, agreementId: agreement.id, milestoneId: milestone.id,
      amount: '1000', currency: 'CKB', rail: 'mock', network: 'sandbox', status: 'funded',
    } });

    await markAgreementFunded(agreement.id);

    await assert.rejects(() => prisma.escrow.update({
      where: { id: escrow.id }, data: { status: 'invented_state' },
    }));
    await assert.rejects(() => prisma.agreement.update({
      where: { id: agreement.id }, data: { amount: '18446744073709551616' },
    }));
    await assert.rejects(() => prisma.milestone.update({
      where: { id: milestone.id }, data: { description: 'Funded terms cannot change' },
    }));

    const transactionData = {
      appId: app.id, agreementId: agreement.id, milestoneId: milestone.id, escrowId: escrow.id,
      type: 'release', rail: 'ckb', network: 'testnet', status: 'confirmed',
      txHash: `0x${'1'.repeat(64)}`, amount: '1000', currency: 'CKB',
    };
    await prisma.transaction.create({ data: { id: randomUUID(), ...transactionData } });
    await assert.rejects(() => prisma.transaction.create({ data: { id: randomUUID(), ...transactionData } }));
  });

  test('idempotency response bodies migrate to native jsonb without losing data', async () => {
    const app = await createIntegrationApp('JSONB App');
    await prisma.idempotencyKey.create({ data: {
      id: randomUUID(), appId: app.id, key: `jsonb-${randomUUID()}`, requestHash: randomUUID(),
      status: 'completed', responseStatus: 201, responseBodyJson: { data: { preserved: true } }, responseBytes: 27,
      processingExpiresAt: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + 3_600_000),
    } });
    const [result] = await prisma.$queryRaw<Array<{ type: string; preserved: string }>>`
      SELECT pg_typeof("responseBodyJson")::text AS type,
             "responseBodyJson"->'data'->>'preserved' AS preserved
      FROM "IdempotencyKey" WHERE "appId" = ${app.id}
    `;
    assert.equal(result.type, 'jsonb');
    assert.equal(result.preserved, 'true');
  });

  test('agreement creation idempotency is concurrency-safe for same key/body', async () => {
    const app = await createIntegrationApp('Idempotency App');
    const body = {
      title: 'Concurrent agreement',
      description: 'Created once',
      clientExternalId: 'client_1',
      workerExternalId: 'worker_1',
      totalAmount: '2500',
      currency: 'CKB',
      releaseMode: 'milestone' as const,
      disputeMode: 'app_managed' as const,
      metadata: { test: true },
    };
    const key = `idem-${randomUUID()}`;

    const attempts = await Promise.allSettled([
      createAgreementForApp(requestStub({ appId: app.id, body, idempotencyKey: key }), app.id, body),
      createAgreementForApp(requestStub({ appId: app.id, body, idempotencyKey: key }), app.id, body),
    ]);

    const fulfilled = attempts.filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled');
    const rejected = attempts.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    assert.equal(fulfilled.length + rejected.length, 2);
    assert.ok(fulfilled.length >= 1);
    if (fulfilled.length === 2) {
      assert.equal(fulfilled[0].value.id, fulfilled[1].value.id);
    } else {
      assert.ok(rejected[0].reason instanceof AppError);
      assert.equal(rejected[0].reason.code, 'idempotency_key_in_progress');
    }

    const agreements = await prisma.agreement.findMany({
      where: {
        appId: app.id,
        title: body.title,
      },
    });
    assert.equal(agreements.length, 1);
  });

  test('webhook SSRF protection rejects redirect targets that resolve private', async () => {
    setWebhookSecurityTestHooks({
      lookupAll: async (hostname) => {
        if (hostname === 'safe.example.com') {
          return [{ address: '93.184.216.34' }];
        }
        if (hostname === 'internal.example.com') {
          return [{ address: '127.0.0.1' }];
        }
        return [{ address: '93.184.216.34' }];
      },
      requestImpl: async () => new Response('', {
        status: 302,
        headers: {
          location: 'http://internal.example.com/webhook',
        },
      }),
    });

    await assert.rejects(
      () => fetchWebhookUrl('https://safe.example.com/webhook', { method: 'POST', body: '{}' }, 'sandbox', 3),
      (error) => error instanceof AppError && error.code === 'webhook_url_not_allowed',
    );
  });

  test('webhook delivery connects to the validated address without resolving it again', async () => {
    const connectedAddresses: string[] = [];
    setWebhookSecurityTestHooks({
      lookupAll: async () => [{ address: '93.184.216.34' }],
      requestImpl: async (_url, _init, address) => {
        connectedAddresses.push(address);
        return new Response('{}', { status: 200 });
      },
    });

    await fetchWebhookUrl('https://safe.example.com/webhook', { method: 'POST', body: '{}' }, 'sandbox', 0);
    assert.deepEqual(connectedAddresses, ['93.184.216.34']);
  });

  test('multi-milestone release leaves agreement open until all escrows release', async () => {
    const app = await createIntegrationApp('Milestone Release App');
    const agreement = await seedAgreement(app.id, { amount: '3000' });
    const milestoneA = await prisma.milestone.create({
      data: {
        id: randomUUID(),
        appId: app.id,
        agreementId: agreement.id,
        title: 'A',
        description: 'First',
        amount: '1000',
        currency: 'CKB',
        sortOrder: 1,
        status: 'approved',
      },
    });
    const milestoneB = await prisma.milestone.create({
      data: {
        id: randomUUID(),
        appId: app.id,
        agreementId: agreement.id,
        title: 'B',
        description: 'Second',
        amount: '2000',
        currency: 'CKB',
        sortOrder: 2,
        status: 'approved',
      },
    });
    const escrowA = await prisma.escrow.create({
      data: {
        id: randomUUID(),
        appId: app.id,
        agreementId: agreement.id,
        milestoneId: milestoneA.id,
        amount: '1000',
        currency: 'CKB',
        rail: 'mock',
        network: 'sandbox',
        status: 'funded',
      },
    });
    const escrowB = await prisma.escrow.create({
      data: {
        id: randomUUID(),
        appId: app.id,
        agreementId: agreement.id,
        milestoneId: milestoneB.id,
        amount: '2000',
        currency: 'CKB',
        rail: 'mock',
        network: 'sandbox',
        status: 'funded',
      },
    });

    await markAgreementFunded(agreement.id);

    await releaseEscrow(
      requestStub({ appId: app.id, body: {}, idempotencyKey: `release-${escrowA.id}` }),
      app.id,
      escrowA.id,
    );
    const afterFirst = await prisma.agreement.findUniqueOrThrow({ where: { id: agreement.id } });
    assert.equal(afterFirst.status, 'approved');

    await releaseEscrow(
      requestStub({ appId: app.id, body: {}, idempotencyKey: `release-${escrowB.id}` }),
      app.id,
      escrowB.id,
    );
    const afterSecond = await prisma.agreement.findUniqueOrThrow({ where: { id: agreement.id } });
    assert.equal(afterSecond.status, 'released');
  });

  test('duplicate release with same idempotency key replays without creating another transaction', async () => {
    const app = await createIntegrationApp('Release Replay App');
    const agreement = await seedAgreement(app.id, { amount: '1000' });
    const milestone = await prisma.milestone.create({
      data: {
        id: randomUUID(),
        appId: app.id,
        agreementId: agreement.id,
        title: 'Replay',
        description: 'Release replay milestone',
        amount: '1000',
        currency: 'CKB',
        sortOrder: 1,
        status: 'approved',
      },
    });
    const escrow = await prisma.escrow.create({
      data: {
        id: randomUUID(),
        appId: app.id,
        agreementId: agreement.id,
        milestoneId: milestone.id,
        amount: '1000',
        currency: 'CKB',
        rail: 'mock',
        network: 'sandbox',
        status: 'funded',
      },
    });
    await markAgreementFunded(agreement.id);
    const key = `release-replay-${escrow.id}`;

    const first = await releaseEscrow(
      requestStub({ appId: app.id, body: {}, idempotencyKey: key }),
      app.id,
      escrow.id,
    );
    const second = await releaseEscrow(
      requestStub({ appId: app.id, body: {}, idempotencyKey: key }),
      app.id,
      escrow.id,
    );

    assert.deepEqual(second, first);

    const releaseTransactions = await prisma.transaction.findMany({
      where: {
        appId: app.id,
        escrowId: escrow.id,
        type: 'release',
      },
    });
    assert.equal(releaseTransactions.length, 1);
    assert.equal(releaseTransactions[0].status, 'confirmed');
  });

  test('concurrent release with different idempotency keys only reserves one adapter operation', async () => {
    const app = await createIntegrationApp('Concurrent Release App');
    const agreement = await seedAgreement(app.id, { amount: '1000' });
    const milestone = await prisma.milestone.create({
      data: {
        id: randomUUID(),
        appId: app.id,
        agreementId: agreement.id,
        title: 'Concurrent',
        description: 'Concurrent release milestone',
        amount: '1000',
        currency: 'CKB',
        sortOrder: 1,
        status: 'approved',
      },
    });
    const escrow = await prisma.escrow.create({
      data: {
        id: randomUUID(),
        appId: app.id,
        agreementId: agreement.id,
        milestoneId: milestone.id,
        amount: '1000',
        currency: 'CKB',
        rail: 'mock',
        network: 'sandbox',
        status: 'funded',
      },
    });

    await markAgreementFunded(agreement.id);

    const attempts = await Promise.allSettled([
      releaseEscrow(
        requestStub({ appId: app.id, body: {}, idempotencyKey: `release-a-${escrow.id}` }),
        app.id,
        escrow.id,
      ),
      releaseEscrow(
        requestStub({ appId: app.id, body: {}, idempotencyKey: `release-b-${escrow.id}` }),
        app.id,
        escrow.id,
      ),
    ]);

    const fulfilled = attempts.filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled');
    const rejected = attempts.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof AppError);
    assert.match(rejected[0].reason.code, /^escrow_(release_in_progress|not_funded)$/);

    const releaseTransactions = await prisma.transaction.findMany({
      where: {
        appId: app.id,
        escrowId: escrow.id,
        type: 'release',
      },
    });
    assert.equal(releaseTransactions.length, 1);
    assert.equal(releaseTransactions[0].status, 'confirmed');
  });

  test('adapter failure is recorded outside the reservation transaction', async () => {
    const app = await createIntegrationApp('Release Failure App');
    const agreement = await seedAgreement(app.id, { status: 'approved', amount: '1000' });
    const escrow = await prisma.escrow.create({
      data: {
        id: randomUUID(),
        appId: app.id,
        agreementId: agreement.id,
        amount: '1000',
        currency: 'CKB',
        rail: 'ckb',
        network: 'testnet',
        status: 'funded',
      },
    });

    await assert.rejects(
      () => releaseEscrow(
        requestStub({ appId: app.id, body: {}, idempotencyKey: `release-failure-${escrow.id}` }),
        app.id,
        escrow.id,
      ),
      (error) => error instanceof AppError && error.code === 'escrow_adapter_not_ready',
    );

    const failedEscrow = await prisma.escrow.findUniqueOrThrow({ where: { id: escrow.id } });
    assert.equal(failedEscrow.status, 'failed');

    const releaseTransaction = await prisma.transaction.findFirstOrThrow({
      where: {
        appId: app.id,
        escrowId: escrow.id,
        type: 'release',
      },
    });
    assert.equal(releaseTransaction.status, 'failed');

    const failedEvent = await prisma.event.findFirst({
      where: {
        appId: app.id,
        escrowId: escrow.id,
        type: 'escrow.failed',
      },
    });
    assert.ok(failedEvent);
  });

  test('refund uses split settlement flow and marks agreement refunded after all escrows refund', async () => {
    const app = await createIntegrationApp('Refund Flow App');
    const agreement = await seedAgreement(app.id, { status: 'funded', amount: '1000' });
    const escrow = await prisma.escrow.create({
      data: {
        id: randomUUID(),
        appId: app.id,
        agreementId: agreement.id,
        amount: '1000',
        currency: 'CKB',
        rail: 'mock',
        network: 'sandbox',
        status: 'funded',
      },
    });

    const refunded = await refundEscrow(
      requestStub({ appId: app.id, body: {}, idempotencyKey: `refund-${escrow.id}` }),
      app.id,
      escrow.id,
    );

    assert.equal(refunded.status, 'refunded');
    const afterRefund = await prisma.agreement.findUniqueOrThrow({ where: { id: agreement.id } });
    assert.equal(afterRefund.status, 'refunded');

    const refundTransaction = await prisma.transaction.findFirstOrThrow({
      where: {
        appId: app.id,
        escrowId: escrow.id,
        type: 'refund',
      },
    });
    assert.equal(refundTransaction.status, 'confirmed');
  });
});
