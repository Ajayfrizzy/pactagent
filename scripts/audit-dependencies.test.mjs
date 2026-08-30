import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'audit-dependencies.mjs');

function runAuditReport(report) {
  const directory = mkdtempSync(resolve(tmpdir(), 'pactagent-audit-'));
  const input = resolve(directory, 'audit.json');
  writeFileSync(input, JSON.stringify(report));
  return spawnSync(process.execPath, [script, '--input', input], { encoding: 'utf8' });
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
