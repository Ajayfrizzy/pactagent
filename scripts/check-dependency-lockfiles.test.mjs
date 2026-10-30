import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkMetadata, copyInstallation } from './check-dependency-lockfiles.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pact-lock-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entry = { version: '1.2.3', integrity: 'sha512-example' };
  const manifest = { dependencies: { example: '^1.0.0' } };
  const lock = { lockfileVersion: 3, packages: { '': {}, 'node_modules/example': entry } };
  const write = (file, value) => writeFileSync(join(root, file), JSON.stringify(value));
  write('package.json', { workspaces: ['server', 'web'] });
  for (const workspace of ['server', 'web']) {
    mkdirSync(join(root, workspace));
    write(`${workspace}/package.json`, manifest);
    write(`${workspace}/package-lock.json`, { lockfileVersion: 3, packages: { '': manifest, 'node_modules/example': entry } });
    lock.packages[workspace] = manifest;
  }
  write('package-lock.json', lock);
  const edit = (file, fn) => {
    const value = JSON.parse(readFileSync(join(root, file), 'utf8'));
    fn(value); write(file, value);
  };
  return { root, edit };
}

test('matching workspace and standalone installation contracts pass', (t) => {
  checkMetadata(fixture(t).root);
});
test('manifest-only changes fail before npm is invoked', (t) => {
  const { root, edit } = fixture(t);
  edit('server/package.json', (p) => { p.dependencies.example = '^2.0.0'; });
  assert.throws(() => checkMetadata(root), /stale dependencies/);
});
test('same-range root-only resolution updates fail for stale standalone locks', (t) => {
  const { root, edit } = fixture(t);
  edit('package-lock.json', (p) => { p.packages['node_modules/example'].version = '1.2.4'; });
  assert.throws(() => checkMetadata(root), /resolutions differ/);
});
test('integrity disagreement fails even at the same package version', (t) => {
  const { root, edit } = fixture(t);
  edit('web/package-lock.json', (p) => { p.packages['node_modules/example'].integrity = 'sha512-other'; });
  assert.throws(() => checkMetadata(root), /web\/example/);
});
test('workspace-local resolution takes precedence over root hoisting', (t) => {
  const { root, edit } = fixture(t);
  edit('package-lock.json', (p) => {
    p.packages['server/node_modules/example'] = { version: '1.9.0', integrity: 'sha512-new' };
  });
  edit('server/package-lock.json', (p) => {
    p.packages['node_modules/example'] = { version: '1.9.0', integrity: 'sha512-new' };
  });
  checkMetadata(root);
});
test('isolated installs exclude developer configuration, code and standalone parent workspace', (t) => {
  const { root } = fixture(t);
  writeFileSync(join(root, 'server/.npmrc'), 'registry=https://example.invalid');
  writeFileSync(join(root, 'server/.env'), 'TEST_ONLY=do-not-copy');
  writeFileSync(join(root, 'server/install.js'), 'throw Error("untrusted code")');
  const destination = join(root, 'isolated'); mkdirSync(destination);
  copyInstallation(root, destination, 'server');
  assert.ok(existsSync(join(destination, 'package-lock.json')));
  for (const file of ['.npmrc', '.env', 'install.js', 'server/package.json']) {
    assert.equal(existsSync(join(destination, file)), false);
  }
  assert.equal(JSON.parse(readFileSync(join(destination, 'package.json'))).workspaces, undefined);
  assert.throws(() => copyInstallation(root, destination, '../'), /Unsupported/);
});
test('root isolation includes workspace manifests but not their standalone locks', (t) => {
  const { root } = fixture(t); const destination = join(root, 'isolated'); mkdirSync(destination);
  copyInstallation(root, destination, 'root');
  assert.ok(existsSync(join(destination, 'server/package.json')));
  assert.equal(existsSync(join(destination, 'server/package-lock.json')), false);
});
