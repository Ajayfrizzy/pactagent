import assert from 'node:assert/strict';
import test from 'node:test';
import { metricsRegistry, validateMetricCardinality } from './metrics';

test('Prometheus metrics never use tenant, resource, request, trace, URL, or address labels', () => {
  assert.deepEqual(validateMetricCardinality(), []);
  for (const metric of metricsRegistry.getMetricsAsArray()) {
    assert.ok(metric.name.startsWith('pactagent_'));
  }
});
