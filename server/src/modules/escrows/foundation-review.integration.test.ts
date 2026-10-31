import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test, { after } from 'node:test';
import { Client } from 'pg';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { databaseIntegrationOptions } from '../../test/integration-helpers';
import { tenantContext } from '../../common/tenancy/tenant-context';
import { CKB_TESTNET, SANDBOX, type Asset } from '../assets/asset-registry';
import { allocate, canonicalJson, freezeTerms } from './funding-terms';
import { storeFoundation } from './foundation.repository';
import { sampleTerms } from './foundation.test-fixture';

after(() => prisma.$disconnect());
async function fixture(tx: Prisma.TransactionClient, asset: Asset) {
  const app = await tx.app.create({ data: { name: 'M1 review', slug: randomUUID(), ownerId: 'm1-review-fixture' } });
  const agreement = await tx.agreement.create({ data: { appId: app.id, title: 'Review', description: '', amount: '1000', deadlineAt: new Date() } });
  const milestone = await tx.milestone.create({ data: { appId: app.id, agreementId: agreement.id, title: 'Review', description: '', amount: '1000', currency: 'CKB', sortOrder: 1 } });
  const escrow = await tx.escrow.create({ data: { appId: app.id, agreementId: agreement.id, milestoneId: milestone.id,
    amount: '1000', currency: 'CKB', rail: asset.chain === 'ckb' ? 'ckb' : 'mock', network: asset.chain === 'ckb' ? 'testnet' : 'sandbox' } });
  const terms = sampleTerms({ appId: app.id, agreementId: agreement.id, milestoneId: milestone.id, escrowId: escrow.id,
    assetId: asset.id, network: asset.network, bounds: { minPrincipal: '1', maxFunding: asset.maxBaseUnits },
    fallback: { workerPrincipal: '370', clientPrincipal: '630', deadline: '100', timing: 'lower-bound-competing', policyVersion: '1' } });
  return { app, escrow, terms, asset };
}
function row(setup: Awaited<ReturnType<typeof fixture>>, principal = '1000', bps = 200) {
  const terms = { ...setup.terms, principal, clientFeeBps: bps, clientFeeDeposit: (BigInt(principal) * BigInt(bps) / 10000n).toString(),
    fallback: { ...setup.terms.fallback, workerPrincipal: '0', clientPrincipal: principal } };
  // A raw insert also exercises SQL independently of service validation.
  return { id: randomUUID(), appId: terms.appId, escrowId: terms.escrowId, agreementId: terms.agreementId, milestoneId: terms.milestoneId,
    assetId: terms.assetId, network: terms.network, deploymentId: terms.deploymentId, termsHash: 'a'.repeat(64),
    canonicalTerms: canonicalJson(terms), principal, clientFeeDeposit: terms.clientFeeDeposit, clientFeeBps: bps, workerFeeBps: 300,
    maxBaseUnits: setup.asset.maxBaseUnits, finalityPolicyVersion: terms.finalityPolicyVersion };
}
function insert(client: Client, data: ReturnType<typeof row>) {
  const keys = Object.keys(data);
  return client.query(`INSERT INTO "EscrowFoundation" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(data));
}

test('database fee quotient agrees with BigInt at uint64/uint256 boundaries and rejects rounded deposits', databaseIntegrationOptions(), async () => {
  const rollback = new Error('rollback fee fixtures');
  await assert.rejects(prisma.$transaction(async (tx) => {
    for (const asset of [CKB_TESTNET, SANDBOX]) {
      const setup = await fixture(tx, asset);
      const vectors: Array<[bigint, number, boolean]> = [
        [10000000000000000014n, 1000, true], [10000000000000000015n, 1000, true], [10000000000000000016n, 1000, true],
        [1n, 1, true], [9999n, 1, true],
      ];
      for (const bps of [0, 1, 999, 1000]) {
        const max = BigInt(asset.maxBaseUnits);
        let p = max * 10000n / BigInt(10000 + bps);
        while (p + 1n + (p + 1n) * BigInt(bps) / 10000n <= max) p++;
        vectors.push([p - 1n, bps, true], [p, bps, true], [p + 1n, bps, false]);
      }
      for (const [p, bps, valid] of vectors) {
        const data = row(setup, p.toString(), bps);
        await tx.$executeRawUnsafe('SAVEPOINT fee_boundary');
        if (valid) {
          const calculated = allocate(asset.id, data.principal, '0', bps, 300);
          assert.equal(data.clientFeeDeposit, calculated.clientFeeDeposit);
          const terms = JSON.parse(data.canonicalTerms);
          assert.equal(freezeTerms(terms).terms.clientFeeDeposit, data.clientFeeDeposit);
          const stored = await storeFoundation(tenantContext(setup.app.id), terms, tx);
          assert.equal(stored.clientFeeDeposit, calculated.clientFeeDeposit);
        } else {
          await assert.rejects(tx.escrowFoundation.create({ data }), /check constraint/i);
        }
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT fee_boundary');
        // Incorrect ceil/rounded-up deposits must not be accepted, even when funding fits.
        await assert.rejects(tx.escrowFoundation.create({ data: { ...data, clientFeeDeposit: (BigInt(data.clientFeeDeposit) + 1n).toString() } }), /check constraint/i);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT fee_boundary');
      }
    }
    throw rollback;
  }, { timeout: 15000 }), (error) => error === rollback);
});

async function blockedBy(observer: Client, waiter: number, holder: number, finished: () => boolean) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ blocked: boolean }>('SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked', [waiter, holder]);
    if (result.rows[0].blocked) return;
    assert.equal(finished(), false, 'competing statement completed instead of waiting for the parent lock');
    await delay(10);
  }
  assert.fail('competing transaction did not block on the parent lock');
}
for (const isolation of ['READ COMMITTED', 'REPEATABLE READ'] as const) {
for (const ordering of ['insert-first', 'update-first'] as const) {
  test(`foundation/parent race (${isolation}, ${ordering}) serializes and rechecks committed scope`, databaseIntegrationOptions(), async () => {
    const setup = await prisma.$transaction((tx) => fixture(tx, CKB_TESTNET));
    const writer = new Client({ connectionString: process.env.DATABASE_URL });
    const updater = new Client({ connectionString: process.env.DATABASE_URL });
    const observer = new Client({ connectionString: process.env.DATABASE_URL });
    await Promise.all([writer.connect(), updater.connect(), observer.connect()]);
    try {
      await writer.query(`BEGIN ISOLATION LEVEL ${isolation}; SET LOCAL statement_timeout = '10s'`);
      await updater.query(`BEGIN ISOLATION LEVEL ${isolation}; SET LOCAL statement_timeout = '10s'`);
      const writerPid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const updaterPid = (await updater.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const update = () => updater.query('UPDATE "Escrow" SET rail = $1, network = $2 WHERE id = $3', ['manual', 'sandbox', setup.escrow.id]);
      let finished = false;
      if (ordering === 'insert-first') {
        await insert(writer, row(setup));
        const pending = update().then(() => ({ code: 'committed' }), (error: { code: string }) => error).finally(() => { finished = true; });
        try { await blockedBy(observer, updaterPid, writerPid, () => finished); }
        finally { await writer.query('COMMIT'); }
        assert.equal((await pending).code, isolation === 'READ COMMITTED' ? '23514' : '40001');
        await updater.query('ROLLBACK');
        const parent = await prisma.escrow.findUniqueOrThrow({ where: { id: setup.escrow.id } });
        assert.deepEqual(parent, setup.escrow, 'locking must not change any persisted parent value');
        assert.equal(parent.rail, 'ckb');
        assert.equal(parent.network, 'testnet');
        assert.equal(await prisma.escrowFoundation.count({ where: { escrowId: parent.id } }), 1);
      } else {
        await update();
        const pending = insert(writer, row(setup)).then(() => ({ code: 'committed' }), (error: { code: string }) => error).finally(() => { finished = true; });
        try { await blockedBy(observer, writerPid, updaterPid, () => finished); }
        finally { await updater.query('COMMIT'); }
        assert.equal((await pending).code, isolation === 'READ COMMITTED' ? '23514' : '40001');
        await writer.query('ROLLBACK');
        assert.equal(await prisma.escrowFoundation.count({ where: { escrowId: setup.escrow.id } }), 0);
        assert.equal((await prisma.escrow.findUniqueOrThrow({ where: { id: setup.escrow.id } })).rail, 'manual');
      }
    } finally {
      await Promise.all([writer.query('ROLLBACK'), updater.query('ROLLBACK')]);
      await Promise.all([writer.end(), updater.end(), observer.end()]);
    }
  });
}
}
