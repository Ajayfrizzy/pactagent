import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const policy = JSON.parse(readFileSync(resolve(root, 'config/dependency-audit-policy.json'), 'utf8'));
const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const threshold = severityRank[policy.minimumSeverity];

if (threshold === undefined) {
  throw new Error(`Unknown minimumSeverity: ${policy.minimumSeverity}`);
}

for (const exception of policy.exceptions) {
  if (!exception.id || !exception.owner || !exception.reason || !exception.expires || !exception.packages?.length) {
    throw new Error('Every dependency audit exception requires id, owner, reason, expiry, and packages.');
  }
  if (Date.parse(exception.expires) < Date.now()) {
    throw new Error(`Dependency audit exception ${exception.id} expired on ${exception.expires}.`);
  }
}

const inputIndex = process.argv.indexOf('--input');
let raw;
if (inputIndex >= 0) {
  raw = readFileSync(resolve(process.argv[inputIndex + 1]), 'utf8');
} else {
  const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  raw = audit.stdout;
  if (!raw.trim()) {
    process.stderr.write(audit.stderr || 'npm audit returned no JSON output.\n');
    process.exit(audit.status || 1);
  }
}

const report = JSON.parse(raw);
const vulnerabilities = report.vulnerabilities || {};
const blocking = Object.entries(vulnerabilities).filter(([, vulnerability]) => (
  (severityRank[vulnerability.severity] ?? 0) >= threshold
));

function exceptionFor(packageName, advisory) {
  if (typeof advisory !== 'object' || advisory === null) return null;
  return policy.exceptions.find((exception) => (
    exception.packages.includes(packageName)
    && (String(advisory.url || '').includes(exception.id) || String(advisory.source) === exception.id)
  ));
}

const acceptedPackages = new Set();
const acceptedExceptions = new Set();
let changed = true;
while (changed) {
  changed = false;
  for (const [packageName, vulnerability] of blocking) {
    if (acceptedPackages.has(packageName)) continue;
    const accepted = (vulnerability.via || []).every((advisory) => {
      if (typeof advisory === 'string') return acceptedPackages.has(advisory);
      const exception = exceptionFor(packageName, advisory);
      if (exception) acceptedExceptions.add(exception.id);
      return Boolean(exception);
    });
    if (accepted) {
      acceptedPackages.add(packageName);
      changed = true;
    }
  }
}

const failures = blocking.filter(([packageName]) => !acceptedPackages.has(packageName));
for (const exceptionId of acceptedExceptions) {
  console.warn(`Accepted temporary dependency advisory exception: ${exceptionId}`);
}

if (failures.length > 0) {
  console.error(`Dependency audit found ${failures.length} unaccepted ${policy.minimumSeverity}+ vulnerabilities:`);
  for (const [packageName, vulnerability] of failures) {
    console.error(`- ${packageName}: ${vulnerability.severity} (${vulnerability.range || 'unknown range'})`);
  }
  process.exit(1);
}

console.log(`Dependency audit passed; ${blocking.length} ${policy.minimumSeverity}+ vulnerability records are covered by active exceptions.`);
