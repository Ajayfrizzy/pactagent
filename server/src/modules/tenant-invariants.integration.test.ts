import assert from 'assert/strict';
import { randomUUID } from 'crypto';
import test, { after, before, describe } from 'node:test';
import { AppError } from '../common/errors/app-error';
import { prisma } from '../db';
import { getAgreementForApp, listAgreementsForApp } from './agreements/agreement.service';
import { createEscrowForApp } from './escrows/escrow.service';
import { createProofForApp } from './proofs/proof.service';
import {
  databaseIntegrationOptions,
  integrationRequest,
  IntegrationFixture,
} from '../test/integration-helpers';

describe('Phase 2 tenant breakout resistance', databaseIntegrationOptions(), () => {
  const fixture = new IntegrationFixture();
  before(() => fixture.connect());
  after(() => fixture.cleanup());

  test('another app cannot get, list, or use agreement and milestone references', async () => {
    const appA = await fixture.createApp('Tenant A');
    const appB = await fixture.createApp('Tenant B');
    const agreement = await fixture.createAgreement(appA.id, { amount: '1000' });
    const milestone = await prisma.milestone.create({
      data: {
        appId: appA.id,
        agreementId: agreement.id,
        title: 'Tenant A only',
        description: '',
        amount: '1000',
        currency: 'CKB',
        sortOrder: 1,
        status: 'funded',
      },
    });
    await prisma.agreement.update({
      where: { id: agreement.id },
      data: { status: 'funded', settlementStatus: 'FUNDED', fundingConfirmedAt: new Date() },
    });

    await assert.rejects(
      () => getAgreementForApp(appB.id, agreement.id),
      (error) => error instanceof AppError && error.code === 'agreement_not_found',
    );
    const list = await listAgreementsForApp(appB.id, {
      externalReferenceId: agreement.id,
      limit: 20,
    });
    assert.deepEqual(list.data, []);

    const proofBody = {
      agreementId: agreement.id,
      milestoneId: milestone.id,
      submittedByExternalId: 'tenant-b-worker',
      type: 'text' as const,
      content: 'Cross-tenant proof',
      links: [],
      fileRefs: [],
    };
    await assert.rejects(
      () => createProofForApp(
        integrationRequest({ appId: appB.id, path: '/v1/proofs', idempotencyKey: randomUUID(), body: proofBody }),
        appB.id,
        proofBody,
      ),
      (error) => error instanceof AppError && error.code === 'agreement_not_found',
    );

    const escrowBody = {
      agreementId: agreement.id,
      milestoneId: milestone.id,
      amount: '1000',
      currency: 'CKB',
      rail: 'mock' as const,
      network: 'sandbox' as const,
    };
    await assert.rejects(
      () => createEscrowForApp(
        integrationRequest({ appId: appB.id, path: '/v1/escrows', idempotencyKey: randomUUID(), body: escrowBody }),
        appB.id,
        escrowBody,
      ),
      (error) => error instanceof AppError && error.code === 'agreement_not_found',
    );
  });

  test('composite foreign keys reject crafted cross-app child rows', async () => {
    const appA = await fixture.createApp('FK Tenant A');
    const appB = await fixture.createApp('FK Tenant B');
    const agreement = await fixture.createAgreement(appA.id);

    await assert.rejects(() => prisma.milestone.create({
      data: {
        id: randomUUID(),
        appId: appB.id,
        agreementId: agreement.id,
        title: 'Invalid tenant child',
        description: '',
        amount: '1',
        currency: 'CKB',
        sortOrder: 1,
      },
    }));
    assert.equal(await prisma.milestone.count({ where: { appId: appB.id, agreementId: agreement.id } }), 0);
  });
});
