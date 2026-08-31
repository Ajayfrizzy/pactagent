import assert from 'assert/strict';
import { randomUUID } from 'crypto';
import test, { after, before, describe } from 'node:test';
import { AppError } from '../common/errors/app-error';
import { prisma } from '../db';
import { createAgreementForApp } from './agreements/agreement.service';
import { createDisputeForApp, resolveDisputeForApp } from './disputes/dispute.service';
import { createEscrowForApp } from './escrows/escrow.service';
import { createMilestoneForAgreement } from './milestones/milestone.service';
import {
  databaseIntegrationOptions,
  integrationRequest,
  IntegrationFixture,
} from '../test/integration-helpers';

describe('Phase 2 financial and settlement invariants', databaseIntegrationOptions(), () => {
  const fixture = new IntegrationFixture();
  before(() => fixture.connect());
  after(() => fixture.cleanup());

  test('concurrent milestone allocations cannot exceed the agreement amount', async () => {
    const app = await fixture.createApp('Concurrent allocation');
    const agreement = await fixture.createAgreement(app.id, { amount: '1000' });
    await prisma.milestone.create({
      data: {
        appId: app.id,
        agreementId: agreement.id,
        title: 'Existing',
        description: 'Already allocated',
        amount: '800',
        currency: 'CKB',
        sortOrder: 1,
      },
    });

    const attempts = await Promise.allSettled([
      createMilestoneForAgreement(
        integrationRequest({
          appId: app.id,
          path: `/v1/agreements/${agreement.id}/milestones`,
          idempotencyKey: randomUUID(),
          body: { title: 'A', description: '', amount: '150', currency: 'CKB', order: 2 },
        }),
        app.id,
        agreement.id,
        { title: 'A', description: '', amount: '150', currency: 'CKB', order: 2 },
      ),
      createMilestoneForAgreement(
        integrationRequest({
          appId: app.id,
          path: `/v1/agreements/${agreement.id}/milestones`,
          idempotencyKey: randomUUID(),
          body: { title: 'B', description: '', amount: '150', currency: 'CKB', order: 3 },
        }),
        app.id,
        agreement.id,
        { title: 'B', description: '', amount: '150', currency: 'CKB', order: 3 },
      ),
    ]);

    assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
    const milestones = await prisma.milestone.findMany({ where: { agreementId: agreement.id } });
    assert.equal(milestones.reduce((sum, milestone) => sum + BigInt(milestone.amount), BigInt(0)), BigInt(950));
  });

  test('user-controlled uniqueness conflicts return stable API errors', async () => {
    const app = await fixture.createApp('Stable uniqueness errors');
    const agreementBody = {
      externalReferenceId: `agreement-${randomUUID()}`,
      title: 'First agreement',
      description: '',
      clientExternalId: 'client_fixture',
      workerExternalId: 'worker_fixture',
      totalAmount: '1000',
      currency: 'CKB',
      releaseMode: 'milestone' as const,
      disputeMode: 'app_managed' as const,
      metadata: {},
    };
    await createAgreementForApp(
      integrationRequest({ appId: app.id, path: '/v1/agreements', idempotencyKey: randomUUID(), body: agreementBody }),
      app.id,
      agreementBody,
    );
    await assert.rejects(
      () => createAgreementForApp(
        integrationRequest({ appId: app.id, path: '/v1/agreements', idempotencyKey: randomUUID(), body: agreementBody }),
        app.id,
        agreementBody,
      ),
      (error) => error instanceof AppError && error.code === 'agreement_already_exists',
    );

    const agreement = await fixture.createAgreement(app.id, { amount: '1000' });
    await prisma.milestone.create({
      data: {
        appId: app.id,
        agreementId: agreement.id,
        title: 'Existing order',
        description: '',
        amount: '500',
        currency: 'CKB',
        sortOrder: 1,
      },
    });
    const milestoneBody = { title: 'Duplicate order', description: '', amount: '500', currency: 'CKB', order: 1 };
    await assert.rejects(
      () => createMilestoneForAgreement(
        integrationRequest({
          appId: app.id,
          path: `/v1/agreements/${agreement.id}/milestones`,
          idempotencyKey: randomUUID(),
          body: milestoneBody,
        }),
        app.id,
        agreement.id,
        milestoneBody,
      ),
      (error) => error instanceof AppError && error.code === 'milestone_already_exists',
    );
  });

  test('concurrent escrow creation leaves one active escrow per scope', async () => {
    const app = await fixture.createApp('Active escrow uniqueness');
    const agreement = await fixture.createAgreement(app.id, { amount: '1000' });
    const milestone = await prisma.milestone.create({
      data: {
        appId: app.id,
        agreementId: agreement.id,
        title: 'Scope',
        description: '',
        amount: '1000',
        currency: 'CKB',
        sortOrder: 1,
      },
    });
    const body = {
      agreementId: agreement.id,
      milestoneId: milestone.id,
      amount: '1000',
      currency: 'CKB',
      rail: 'mock' as const,
      network: 'sandbox' as const,
    };
    const attempts = await Promise.allSettled([
      createEscrowForApp(integrationRequest({ appId: app.id, path: '/v1/escrows', idempotencyKey: randomUUID(), body }), app.id, body),
      createEscrowForApp(integrationRequest({ appId: app.id, path: '/v1/escrows', idempotencyKey: randomUUID(), body }), app.id, body),
    ]);

    assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
    assert.equal(await prisma.escrow.count({ where: { appId: app.id, milestoneId: milestone.id } }), 1);
    const rejected = attempts.find((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected');
    assert.ok(rejected?.reason instanceof AppError);
    assert.equal(rejected.reason.code, 'active_escrow_exists');
  });

  test('failed and reconciliation-required escrows keep settlement scope reserved', async () => {
    const app = await fixture.createApp('Unresolved escrow scope');
    const agreement = await fixture.createAgreement(app.id, { amount: '1000' });

    for (const [index, status] of ['failed', 'reconciliation_required'].entries()) {
      const milestone = await prisma.milestone.create({
        data: {
          appId: app.id,
          agreementId: agreement.id,
          title: `Unresolved ${status}`,
          description: '',
          amount: '500',
          currency: 'CKB',
          sortOrder: index + 1,
        },
      });
      await prisma.escrow.create({
        data: {
          appId: app.id,
          agreementId: agreement.id,
          milestoneId: milestone.id,
          amount: '500',
          currency: 'CKB',
          rail: 'mock',
          network: 'sandbox',
          status,
        },
      });

      const body = {
        agreementId: agreement.id,
        milestoneId: milestone.id,
        amount: '500',
        currency: 'CKB',
        rail: 'mock' as const,
        network: 'sandbox' as const,
      };
      await assert.rejects(
        () => createEscrowForApp(
          integrationRequest({ appId: app.id, path: '/v1/escrows', idempotencyKey: randomUUID(), body }),
          app.id,
          body,
        ),
        (error) => error instanceof AppError && error.code === 'active_escrow_exists',
      );
      await assert.rejects(() => prisma.escrow.create({ data: {
        appId: app.id,
        agreementId: agreement.id,
        milestoneId: milestone.id,
        amount: '500',
        currency: 'CKB',
        rail: 'mock',
        network: 'sandbox',
        status: 'not_created',
      } }));
    }
  });

  test('unresolved dispute scope is unique and split must equal funded amount', async () => {
    const app = await fixture.createApp('Dispute scope');
    const agreement = await fixture.createAgreement(app.id, { amount: '1000' });
    const milestone = await prisma.milestone.create({
      data: {
        appId: app.id,
        agreementId: agreement.id,
        title: 'Disputed',
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
    await prisma.escrow.create({
      data: {
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
    const body = {
      agreementId: agreement.id,
      milestoneId: milestone.id,
      openedByExternalId: 'client_fixture',
      reason: 'Settlement disagreement',
      evidenceLinks: [],
    };
    const opened = await createDisputeForApp(
      integrationRequest({ appId: app.id, path: '/v1/disputes', idempotencyKey: randomUUID(), body }),
      app.id,
      body,
    );

    await assert.rejects(
      () => createDisputeForApp(
        integrationRequest({ appId: app.id, path: '/v1/disputes', idempotencyKey: randomUUID(), body }),
        app.id,
        body,
      ),
      (error) => error instanceof AppError && error.code === 'active_dispute_exists',
    );
    await assert.rejects(
      () => resolveDisputeForApp(
        integrationRequest({ appId: app.id, path: `/v1/disputes/${opened.id}/resolve`, idempotencyKey: randomUUID(), body: {} }),
        app.id,
        opened.id,
        { resolutionType: 'split', workerAmount: '400', clientAmount: '599' },
      ),
      (error) => error instanceof AppError && error.code === 'invalid_settlement_split',
    );

    const resolved = await resolveDisputeForApp(
      integrationRequest({ appId: app.id, path: `/v1/disputes/${opened.id}/resolve`, idempotencyKey: randomUUID(), body: {} }),
      app.id,
      opened.id,
      { resolutionType: 'split', workerAmount: '0', clientAmount: '1000' },
    );
    assert.equal(resolved.status, 'resolved_split');
  });
});
