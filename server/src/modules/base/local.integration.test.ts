import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { prisma } from '../../db';
import { databaseIntegrationOptions } from '../../test/integration-helpers';
import { tenantContext } from '../../common/tenancy/tenant-context';
import { localTerms, wordId } from './fixtures';
import { sha256 } from './artifacts';
import { storeLocalEscrow, reserveLocalArtifact, recoverLocalArtifact } from './local.repository';
import { appendLocalObservation } from './local-evidence.repository';
const key = { version: 'local-fixture-1', bytes: randomBytes(32) };
after(() => prisma.$disconnect());
async function setup() {
  return prisma.$transaction(async tx => {
    const app = await tx.app.create({ data: { name: 'M2 local fixture', slug: randomUUID(), ownerId: 'm2-test' } });
    const tenant = tenantContext(app.id);
    const agreement = await tx.agreement.create({ data: { appId: app.id, title: 'M2 local', description: '', currency: 'TEST', amount: '1000001', deadlineAt: new Date() } });
    const milestone = await tx.milestone.create({ data: { appId: app.id, agreementId: agreement.id, title: 'local', description: '', amount: '1000001', currency: 'TEST', sortOrder: 0 } });
    const terms = { ...localTerms(), appId: `0x${sha256(app.id)}`, agreementId: `0x${sha256(agreement.id)}`, milestoneId: `0x${sha256(milestone.id)}` };
    const input = { agreementId: agreement.id, milestoneId: milestone.id, instance: `0x${randomBytes(20).toString('hex')}`, terms };
    const escrow = await storeLocalEscrow(tx, tenant, input);
    return { tenant, escrow, input };
  });
}
const proposal = (escrowId: string, idempotencyKey = 'local') => ({ escrowId, idempotencyKey, action: 'mutual' as const,
  signedArtifact: 'local-fixture-no-real-signature', transactionId: wordId(8) });
test('M2 same-key concurrent reservation persists one encrypted artifact and recoverable pending operation', databaseIntegrationOptions(), async () => {
  const { tenant, escrow } = await setup();
  const results = await Promise.all([1,2].map(() => prisma.$transaction(tx => reserveLocalArtifact(tx, tenant, proposal(escrow.id), key))));
  assert.equal(results[0].id, results[1].id);
  assert.notEqual(results[0].encryptedArtifact, proposal(escrow.id).signedArtifact);
  assert.equal(await prisma.baseLocalOperation.count({ where: { appId: tenant.appId } }), 1);
  assert.equal(await prisma.baseLocalEvidence.count({ where: { appId: tenant.appId } }), 1);
  // A fresh transaction models process restart; plaintext exists only after authenticated recovery.
  const recovered = await prisma.$transaction(tx => recoverLocalArtifact(tx, tenant, results[0].id, key));
  assert.deepEqual(recovered, { artifact: proposal(escrow.id).signedArtifact, transactionId: wordId(8) });
  await assert.rejects(prisma.$transaction(tx => reserveLocalArtifact(tx, tenant, { ...proposal(escrow.id), signedArtifact: 'changed' }, key)));
  await assert.rejects(prisma.$transaction(tx => reserveLocalArtifact(tx, tenant, proposal(escrow.id, 'different'), key)));
});
test('M2 tenant, parent, activation and immutable database boundaries', databaseIntegrationOptions(), async () => {
  const a = await setup(), b = await setup();
  await assert.rejects(prisma.$transaction(tx => reserveLocalArtifact(tx, b.tenant, proposal(a.escrow.id), key)));
  await assert.rejects(prisma.$transaction(tx => storeLocalEscrow(tx, a.tenant, { ...b.input, terms: a.input.terms })));
  const op = await prisma.$transaction(tx => reserveLocalArtifact(tx, a.tenant, proposal(a.escrow.id), key));
  await assert.rejects(prisma.$transaction(tx => recoverLocalArtifact(tx, b.tenant, op.id, key)));
  const { createdAt: _date, ...data } = a.escrow;
  await assert.rejects(prisma.baseLocalEscrow.create({ data: { ...data, id: randomUUID(), appId: b.tenant.appId, instance: `0x${randomBytes(20).toString('hex')}` } }));
  await assert.rejects(prisma.baseLocalEscrow.create({ data: { ...data, id: randomUUID(), chainId: 84532, instance: `0x${randomBytes(20).toString('hex')}` } }));
  await assert.rejects(prisma.baseLocalEscrow.update({ where: { id: a.escrow.id }, data: { termsHash: wordId(77) } }));
  await assert.rejects(prisma.baseLocalOperation.delete({ where: { id: op.id } }));
  await assert.rejects(prisma.milestone.update({ where: { id: a.input.milestoneId }, data: { agreementId: b.input.agreementId } }));
});
test('M2 crash rollback, immutable observations, duplicate ingestion and historical correction', databaseIntegrationOptions(), async () => {
  const { tenant, escrow } = await setup();
  const crash = new Error('simulated_crash_before_commit');
  await assert.rejects(prisma.$transaction(async tx => { await reserveLocalArtifact(tx, tenant, proposal(escrow.id), key); throw crash; }), e => e === crash);
  assert.equal(await prisma.baseLocalOperation.count({ where: { appId: tenant.appId } }), 0);
  const op = await prisma.$transaction(tx => reserveLocalArtifact(tx, tenant, proposal(escrow.id), key));
  const observation = { state: 'finalized' as const, blockHash: wordId(9), blockNumber: '16', evidenceHash: wordId(11), reason: 'local_verified' };
  const results = await Promise.all([1,2].map(() => prisma.$transaction(tx => appendLocalObservation(tx, tenant, op.id, observation))));
  assert.equal(results[0].id, results[1].id);
  const correction = await prisma.$transaction(tx => appendLocalObservation(tx, tenant, op.id, { ...observation, blockHash: wordId(10) }));
  assert.equal(correction.state, 'reconciliation_required');
  const reappeared = await prisma.$transaction(tx => appendLocalObservation(tx, tenant, op.id, observation));
  assert.equal(reappeared.state, 'reconciliation_required');
  await assert.rejects(prisma.baseLocalEvidence.delete({ where: { id: correction.id } }));
  assert.deepEqual(await prisma.$transaction(tx => recoverLocalArtifact(tx, tenant, op.id, key)), { artifact: proposal(escrow.id).signedArtifact, transactionId: wordId(8) });
});
