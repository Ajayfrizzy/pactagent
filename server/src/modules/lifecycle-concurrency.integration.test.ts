import assert from 'assert/strict';
import test, { after, before, describe } from 'node:test';
import { AppError } from '../common/errors/app-error';
import { prisma } from '../db';
import { tenantContext } from '../common/tenancy/tenant-context';
import { transitionAgreementStatus } from './agreements/agreement.repository';
import {
  databaseIntegrationOptions,
  IntegrationFixture,
} from '../test/integration-helpers';

describe('Phase 2 lifecycle compare-and-swap', databaseIntegrationOptions(), () => {
  const fixture = new IntegrationFixture();
  before(() => fixture.connect());
  after(() => fixture.cleanup());

  test('incompatible concurrent agreement transitions have one winner', async () => {
    const app = await fixture.createApp('Agreement CAS');
    const agreement = await fixture.createAgreement(app.id, { status: 'funded' });
    const attempts = await Promise.allSettled([
      prisma.$transaction((tx) => transitionAgreementStatus(
        tenantContext(app.id), agreement.id, 'funded', 'in_progress', tx,
      )),
      prisma.$transaction((tx) => transitionAgreementStatus(
        tenantContext(app.id), agreement.id, 'funded', 'disputed', tx,
      )),
    ]);

    assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
    const rejected = attempts.find((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected');
    assert.ok(rejected?.reason instanceof AppError);
    assert.equal(rejected.reason.code, 'lifecycle_conflict');
    const current = await prisma.agreement.findUniqueOrThrow({ where: { id: agreement.id } });
    assert.ok(['in_progress', 'disputed'].includes(current.status));
  });

  test('a stale transition cannot overwrite a terminal agreement state', async () => {
    const app = await fixture.createApp('Terminal CAS');
    const agreement = await fixture.createAgreement(app.id, { status: 'release_pending' });
    await prisma.$transaction((tx) => transitionAgreementStatus(
      tenantContext(app.id), agreement.id, 'release_pending', 'released', tx,
    ));
    await assert.rejects(
      () => prisma.$transaction((tx) => transitionAgreementStatus(
        tenantContext(app.id), agreement.id, 'release_pending', 'released', tx,
      )),
      (error) => error instanceof AppError && error.code === 'lifecycle_conflict',
    );
    assert.equal((await prisma.agreement.findUniqueOrThrow({ where: { id: agreement.id } })).status, 'released');
  });
});
