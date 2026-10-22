import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'audit-dependencies.mjs');

const fixturePolicy = {
  minimumSeverity: 'high',
  exceptions: [{
    id: 'GHSA-ggr8-5vv4-36mx', packages: ['deepmerge-ts'], owner: 'test',
    expires: '2999-01-01', reason: 'Test fixture for advisory chain handling.',
  }],
};

function runAuditReport(report, policy = fixturePolicy) {
  const directory = mkdtempSync(resolve(tmpdir(), 'pactagent-audit-'));
  const input = resolve(directory, 'audit.json');
  writeFileSync(input, JSON.stringify(report));
  const policyPath = resolve(directory, 'policy.json');
  writeFileSync(policyPath, JSON.stringify(policy));
  return spawnSync(process.execPath, [script, '--input', input, '--policy', policyPath], { encoding: 'utf8' });
}

function runAudit(vulnerabilities) {
  return runAuditReport({ vulnerabilities });
}

test('accepted advisories cover only their transitive vulnerability chains', () => {
  const result = runAudit({
    'deepmerge-ts': {
      severity: 'high',
      range: '*',
      via: [{ source: 1, url: 'https://github.com/advisories/GHSA-ggr8-5vv4-36mx' }],
    },
    '@prisma/config': { severity: 'high', range: '*', via: ['deepmerge-ts'] },
    '@prisma/dev': { severity: 'moderate', range: '*', via: [] },
    prisma: { severity: 'high', range: '*', via: ['@prisma/config', '@prisma/dev'] },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /covered by active exceptions/);
});

test('an unrelated high vulnerability still fails the gate', () => {
  const result = runAudit({
    example: {
      severity: 'high',
      range: '*',
      via: [{ source: 3, url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz' }],
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /example: high/);
});

test('an unavailable npm audit endpoint fails closed', () => {
  const result = runAuditReport({
    message: 'audit endpoint unavailable',
    error: { summary: '', detail: '' },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not return a vulnerability report/);
});

test('expired exceptions fail even when the report is clean', () => {
  const result = runAuditReport({ vulnerabilities: {} }, {
    ...fixturePolicy,
    exceptions: [{ ...fixturePolicy.exceptions[0], expires: '2000-01-01' }],
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /expired on 2000-01-01/);
});

test('a clean report passes without exceptions', () => {
  const result = runAuditReport({ vulnerabilities: {} }, { minimumSeverity: 'high', exceptions: [] });
  assert.equal(result.status, 0, result.stderr);
});
