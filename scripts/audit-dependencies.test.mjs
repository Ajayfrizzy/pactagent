import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'audit-dependencies.mjs');

function runAudit(vulnerabilities) {
  const directory = mkdtempSync(resolve(tmpdir(), 'pactagent-audit-'));
  const input = resolve(directory, 'audit.json');
  writeFileSync(input, JSON.stringify({ vulnerabilities }));
  return spawnSync(process.execPath, [script, '--input', input], { encoding: 'utf8' });
}

test('accepted advisories cover only their transitive vulnerability chains', () => {
  const result = runAudit({
    elliptic: {
      severity: 'high',
      range: '*',
      via: [{ source: 1, url: 'https://github.com/advisories/GHSA-848j-6mx2-7j84' }],
    },
    '@joyid/ckb': { severity: 'high', range: '*', via: ['elliptic'] },
    sharp: {
      severity: 'high',
      range: '<0.35.0',
      via: [{ source: 2, url: 'https://github.com/advisories/GHSA-f88m-g3jw-g9cj' }],
    },
    next: { severity: 'high', range: '*', via: ['sharp'] },
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
