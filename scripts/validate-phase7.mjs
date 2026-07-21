import assert from 'node:assert/strict';
import fs from 'node:fs';

const exerciseCatalog = JSON.parse(fs.readFileSync('config/operations-exercises.json', 'utf8'));
assert.equal(exerciseCatalog.exercises.length, 5);
for (const exercise of exerciseCatalog.exercises) {
  for (const field of ['id', 'owner', 'command', 'expectedEvidence', 'abortCondition']) assert.ok(exercise[field], `${exercise.id || 'exercise'} missing ${field}`);
}

const loadTests = ['api', 'queue', 'webhooks'];
for (const name of loadTests) {
  const source = fs.readFileSync(`test/load/${name}.js`, 'utf8');
  assert.match(source, /thresholds\s*:/, `${name} load test has no thresholds`);
  assert.match(source, /http_req_failed/, `${name} load test has no error threshold`);
  assert.match(source, /p\(95\)</, `${name} load test has no latency threshold`);
  assert.match(source, /check\(/, `${name} load test has no correctness check`);
}

const paginationRepositories = [
  'agreements/agreement.repository.ts', 'apps/app.repository.ts', 'api-keys/api-key.repository.ts',
  'audit-logs/audit-log.repository.ts', 'disputes/dispute.repository.ts', 'escrows/escrow.repository.ts',
  'events/event.repository.ts', 'milestones/milestone.repository.ts', 'proofs/proof.repository.ts',
  'reviews/review.repository.ts', 'transactions/transaction.repository.ts', 'webhooks/webhook.repository.ts',
];
for (const relative of paginationRepositories) {
  const source = fs.readFileSync(`server/src/modules/${relative}`, 'utf8');
  assert.match(source, /take:\s*(?:params\.|query\.)?limit\s*\+\s*1/, `${relative} must fetch one extra row`);
  assert.match(source, /cursor:\s*\{\s*id:/, `${relative} must use an ID cursor`);
  assert.match(source, /skip:\s*1/, `${relative} must exclude the cursor row`);
}

const queryPlans = fs.readFileSync('server/prisma/performance-query-plans.sql', 'utf8');
assert.ok((queryPlans.match(/EXPLAIN \(ANALYZE, BUFFERS, FORMAT JSON\)/g) || []).length >= 4);
process.stdout.write(`Validated ${loadTests.length} load profiles, ${paginationRepositories.length} pagination repositories, ${exerciseCatalog.exercises.length} exercises, and critical query plans.\n`);
