import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { tenantContext } from '../../common/tenancy/tenant-context';
import { databaseIntegrationOptions } from '../../test/integration-helpers';
import { reserveOperation, storeFoundation } from './foundation.repository';
import { sampleTerms } from './foundation.test-fixture';

async function rejection(tx: Prisma.TransactionClient, run: () => Promise<unknown>) {
  await tx.$executeRawUnsafe('SAVEPOINT rejected_write');
  await assert.rejects(run);
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT rejected_write');
}
after(() => prisma.$disconnect());
test('M1 PostgreSQL tenant, full parent, immutable terms, operation uniqueness and conservation', databaseIntegrationOptions(), async () => {
  const rollback = new Error('rollback isolated fixture');
  await assert.rejects(prisma.$transaction(async (tx) => {
    const app = await tx.app.create({ data: { name: 'M1 fixture', slug: randomUUID(), ownerId: 'm1-test' } });
    const other = await tx.app.create({ data: { name: 'M1 other', slug: randomUUID(), ownerId: 'm1-test' } });
    const tenant = tenantContext(app.id);
    const agreement = await tx.agreement.create({ data: { appId: app.id, title: 'M1', description: '', amount: '1000', deadlineAt: new Date() } });
    const wrongAgreement = await tx.agreement.create({ data: { appId: app.id, title: 'wrong', description: '', amount: '1000', deadlineAt: new Date() } });
    const escrow = await tx.escrow.create({ data: { appId: app.id, agreementId: agreement.id, amount: '1000', currency: 'CKB' } });
    const terms = sampleTerms({ appId: app.id, agreementId: agreement.id, escrowId: escrow.id });
    await assert.rejects(storeFoundation(tenantContext(other.id), terms, tx));
    await assert.rejects(storeFoundation(tenant, { ...terms, agreementId: wrongAgreement.id }, tx));
    const foundation = await storeFoundation(tenant, terms, tx);
    assert.equal((await storeFoundation(tenant, terms, tx)).id, foundation.id);
    await assert.rejects(storeFoundation(tenant, { ...terms, treasury: { recipient: 'tampered', version: '2' } }, tx));
    const { id: _id, createdAt: _date, ...data } = foundation;
    await rejection(tx, () => tx.escrowFoundation.create({ data: { ...data, appId: other.id } }));
    await rejection(tx, () => tx.escrowFoundation.create({ data: { ...data, agreementId: wrongAgreement.id } }));
    await rejection(tx, () => tx.escrowFoundation.update({ where: { id: foundation.id }, data: { principal: '999' } }));
    await rejection(tx, () => tx.escrow.update({ where: { id: escrow.id }, data: { agreementId: wrongAgreement.id } }));
    const input = { foundationId: foundation.id, idempotencyKey: 'key', workerPrincipal: '370', clientPrincipal: '630', revision: '0' };
    const operation = await reserveOperation(tenant, input, tx);
    assert.equal((await reserveOperation(tenant, input, tx)).id, operation.id);
    await assert.rejects(reserveOperation(tenant, { ...input, workerPrincipal: '400', clientPrincipal: '600' }, tx));
    await assert.rejects(reserveOperation(tenantContext(other.id), input, tx));
    await rejection(tx, () => reserveOperation(tenant, { ...input, idempotencyKey: 'different' }, tx));
    await rejection(tx, () => tx.settlementOperation.update({ where: { id: operation.id }, data: { state: 'settled' } }));
    const { id: _opId, createdAt: _opDate, ...opData } = operation;
    await rejection(tx, () => tx.settlementOperation.create({ data: { ...opData, idempotencyKey: 'bad', principalWorker: '371' } }));
    const attempt = await tx.broadcastAttempt.create({ data: { appId: app.id, operationId: operation.id, attempt: 1,
      transactionId: 'synthetic-tx', artifactHash: 'a'.repeat(64), artifactReference: 'test:artifact', authorizationProofHash: 'b'.repeat(64), outcome: 'unknown' } });
    await rejection(tx, () => tx.broadcastAttempt.create({ data: { appId: other.id, operationId: operation.id, attempt: 2,
      transactionId: 'synthetic-tx', artifactHash: 'a'.repeat(64), artifactReference: 'test:artifact', authorizationProofHash: 'b'.repeat(64), outcome: 'unknown' } }));
    await rejection(tx, () => tx.chainObservation.create({ data: { appId: app.id, operationId: operation.id, attemptId: attempt.id,
      policyVersion: 'unknown', transactionId: 'wrong-tx', canonical: 'unknown', evidenceJson: '{}' } }));
    const observation = await tx.chainObservation.create({ data: { appId: app.id, operationId: operation.id, attemptId: attempt.id,
      policyVersion: 'unknown', transactionId: 'synthetic-tx', canonical: 'unknown', evidenceJson: '{}' } });
    await rejection(tx, () => tx.chainObservation.delete({ where: { id: observation.id } }));
    throw rollback;
  }), (error) => error === rollback);
});

test('concurrent operation reservations retain one durable identity across keys', databaseIntegrationOptions(), async () => {
  // Kept in the disposable DB: append-only commitments intentionally cannot be deleted.
  const setup = await prisma.$transaction(async (tx) => {
    const app = await tx.app.create({ data: { name: 'M1 race', slug: randomUUID(), ownerId: 'm1-test' } });
    const agreement = await tx.agreement.create({ data: { appId: app.id, title: 'race', description: '', amount: '1000', deadlineAt: new Date() } });
    const escrow = await tx.escrow.create({ data: { appId: app.id, agreementId: agreement.id, amount: '1000', currency: 'CKB' } });
    const tenant = tenantContext(app.id);
    const foundation = await storeFoundation(tenant, sampleTerms({ appId: app.id, agreementId: agreement.id, escrowId: escrow.id }), tx);
    return { tenant, foundation };
  });
  const input = { foundationId: setup.foundation.id, workerPrincipal: '370', clientPrincipal: '630', revision: '0' };
  const results = await Promise.allSettled(['one', 'two'].map((idempotencyKey) => prisma.$transaction((tx) => reserveOperation(setup.tenant, { ...input, idempotencyKey }, tx))));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await prisma.settlementOperation.count({ where: { appId: setup.tenant.appId, foundationId: setup.foundation.id } }), 1);
});
