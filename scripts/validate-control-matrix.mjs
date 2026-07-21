import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const matrix = JSON.parse(readFileSync(resolve(root, 'config/infrastructure-controls.json'), 'utf8'));
const expected = new Set(Array.from({ length: 27 }, (_, index) => index + 1));
const ids = new Set();
const failures = [];

for (const control of matrix.controls || []) {
  if (ids.has(control.id)) failures.push(`Duplicate control ID: ${control.id}`);
  ids.add(control.id);
  expected.delete(control.backlog);
  if (![0, 1, 2, 3, 4, 5, 6, 7].includes(control.phase)) failures.push(`${control.id}: invalid phase`);
  if (!['partial', 'implemented', 'documented', 'external'].includes(control.status)) failures.push(`${control.id}: invalid status`);
  if (!Array.isArray(control.evidence) || control.evidence.length === 0) failures.push(`${control.id}: evidence is required`);
  for (const path of control.evidence || []) {
    if (!existsSync(resolve(root, path))) failures.push(`${control.id}: missing evidence path ${path}`);
  }
}

if (expected.size > 0) failures.push(`Missing backlog controls: ${[...expected].join(', ')}`);
if (failures.length > 0) {
  failures.forEach((failure) => console.error(failure));
  process.exit(1);
}
console.log(`Validated ${matrix.controls.length} infrastructure controls and their evidence paths.`);
