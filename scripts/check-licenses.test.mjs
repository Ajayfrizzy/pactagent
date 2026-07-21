import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkLicenses } from './check-licenses.mjs';

function fixture(name, license) {
  const root = resolve(tmpdir(), `pactagent-license-${process.pid}-${name}`);
  const packagePath = resolve(root, 'node_modules', name);
  mkdirSync(packagePath, { recursive: true });
  writeFileSync(resolve(packagePath, 'package.json'), JSON.stringify({ name, version: '1.0.0', license }));
  writeFileSync(resolve(root, 'policy.json'), JSON.stringify({
    allowed: ['MIT'],
    denied: ['AGPL-3.0-only'],
    exceptions: {},
  }));
  return root;
}

test('license policy accepts an allowed dependency', () => {
  const root = fixture('allowed-package', 'MIT');
  const result = checkLicenses({ root, scanPaths: ['node_modules'], policyPath: resolve(root, 'policy.json') });
  assert.deepEqual(result.failures, []);
});

test('license policy rejects a forbidden dependency', () => {
  const root = fixture('forbidden-package', 'AGPL-3.0-only');
  const result = checkLicenses({ root, scanPaths: ['node_modules'], policyPath: resolve(root, 'policy.json') });
  assert.match(result.failures.join('\n'), /explicitly denied license AGPL-3.0-only/);
});
