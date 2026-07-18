import test from 'node:test';
import assert from 'node:assert/strict';
import { getHealthStatus } from './health.service';

test('health status is a lightweight liveness response', () => {
  const health = getHealthStatus();

  assert.equal(health.status, 'ok');
  assert.match(health.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});
