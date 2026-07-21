import assert from 'node:assert/strict';
import test from 'node:test';
import { retentionCutoffs, runRetention, type RetentionDatabase } from './retentionService';

test('retention cutoffs are deterministic and keep idempotency expiry exact', () => {
  const now = new Date('2026-07-21T00:00:00.000Z');
  const cutoffs = retentionCutoffs(now);
  assert.equal(cutoffs.idempotency.toISOString(), now.toISOString());
  assert.ok(cutoffs.webhookDelivery < now);
  assert.ok(cutoffs.event < cutoffs.webhookDelivery);
  assert.ok(cutoffs.auditArchive < cutoffs.event);
});

test('retention dry run reports all eligible rows without mutation', async () => {
  const queries: string[] = [];
  const database: RetentionDatabase = {
    async $queryRawUnsafe<T>(query: string) {
      queries.push(query);
      return [{ count: 7 }] as T;
    },
  };
  const results = await runRetention({ dryRun: true, batchSize: 2, maxBatches: 1 }, database);
  assert.equal(results.length, 5);
  assert.ok(results.every((result) => result.eligible === 7 && result.affected === 0 && result.batches === 0));
  assert.ok(queries.every((query) => query.startsWith('SELECT COUNT')));
});

test('live retention is bounded and reports resumable work', async () => {
  const database: RetentionDatabase = {
    async $queryRawUnsafe<T>(query: string, _cutoff: unknown, batchSize?: unknown) {
      if (query.startsWith('SELECT COUNT')) return [{ count: 9 }] as T;
      return Array.from({ length: Number(batchSize) }, (_, index) => ({ id: `row_${index}` })) as T;
    },
  };
  const results = await runRetention({ dryRun: false, batchSize: 2, maxBatches: 2 }, database);
  assert.ok(results.every((result) => result.affected === 4 && result.batches === 2 && result.truncated));
});
