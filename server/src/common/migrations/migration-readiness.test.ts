import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateMigrationReadiness } from './migration-readiness';

test('migration readiness accepts every successfully applied migration', () => {
  const result = evaluateMigrationReadiness(['001_baseline', '002_constraints'], [
    { migration_name: '001_baseline', finished_at: new Date(), rolled_back_at: null },
    { migration_name: '002_constraints', finished_at: new Date(), rolled_back_at: null },
  ]);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.missing, []);
});

test('migration readiness reports missing and failed migrations', () => {
  const result = evaluateMigrationReadiness(['001_baseline', '002_constraints', '003_jsonb'], [
    { migration_name: '001_baseline', finished_at: new Date(), rolled_back_at: null },
    { migration_name: '002_constraints', finished_at: null, rolled_back_at: null },
  ]);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.missing, ['002_constraints', '003_jsonb']);
  assert.deepEqual(result.failed, ['002_constraints']);
});
