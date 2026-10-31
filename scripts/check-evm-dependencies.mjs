import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = 'contracts/evm/lib/openzeppelin-contracts/';
const manifest = JSON.parse(readFileSync('contracts/evm/dependencies.json', 'utf8'));
assert.equal(manifest.version, '5.4.0');
assert.equal(JSON.parse(readFileSync(root + 'package.json', 'utf8')).version, manifest.version);
for (const [path, expected] of Object.entries(manifest.files)) {
  assert.equal(createHash('sha256').update(readFileSync(root + path)).digest('hex'), expected, path);
}
const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${path}${e.name}/`) : [`${path}${e.name}`]);
assert.deepEqual(walk(root).filter(p => p.endsWith('.sol')).map(p => p.slice(root.length)).sort(), Object.keys(manifest.files).sort());
console.log(`Verified ${Object.keys(manifest.files).length} unmodified pinned OpenZeppelin source files.`);
