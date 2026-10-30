import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const workspaces = ['server', 'web'];
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function snapshot(manifest, entry, label) {
  if (!entry) throw new Error(`${label}: missing lockfile manifest snapshot`);
  for (const section of sections) {
    if (!isDeepStrictEqual(manifest[section] || {}, entry[section] || {})) {
      throw new Error(`${label}: stale ${section}; update all affected lockfiles together`);
    }
  }
}

export function checkMetadata(root) {
  const manifest = readJson(join(root, 'package.json'));
  if (!isDeepStrictEqual(manifest.workspaces, workspaces)) {
    throw new Error('Workspace layout changed; update the three-installation validation contract');
  }
  const lock = readJson(join(root, 'package-lock.json'));
  if (lock.lockfileVersion !== 3) throw new Error('Root lockfile must use format 3');
  snapshot(manifest, lock.packages?.[''], 'root');
  for (const workspace of workspaces) {
    const localManifest = readJson(join(root, workspace, 'package.json'));
    const standalone = readJson(join(root, workspace, 'package-lock.json'));
    if (standalone.lockfileVersion !== 3) throw new Error(`${workspace}: lockfile must use format 3`);
    snapshot(localManifest, lock.packages?.[workspace], `root/${workspace}`);
    snapshot(localManifest, standalone.packages?.[''], `standalone/${workspace}`);
    // Direct dependency parity prevents a valid but stale standalone lock from
    // silently retaining an older version after a lockfile-only root update.
    for (const name of Object.keys({ ...localManifest.dependencies, ...localManifest.devDependencies, ...localManifest.optionalDependencies })) {
      const shared = lock.packages[`${workspace}/node_modules/${name}`] || lock.packages[`node_modules/${name}`];
      const local = standalone.packages[`node_modules/${name}`];
      if (!shared?.version || !local?.version || shared.version !== local.version || shared.integrity !== local.integrity) {
        throw new Error(`${workspace}/${name}: root and standalone resolutions differ; synchronize and review both locks`);
      }
    }
  }
}

export function copyInstallation(root, destination, scope) {
  if (!['root', ...workspaces].includes(scope)) throw new Error(`Unsupported installation: ${scope}`);
  const files = scope === 'root'
    ? ['package.json', 'package-lock.json', ...workspaces.map((name) => `${name}/package.json`)]
    : ['package.json', 'package-lock.json'];
  const source = scope === 'root' ? root : join(root, scope);
  // Do not copy .npmrc, .env, source, lifecycle scripts or a parent workspace.
  for (const file of files) {
    const target = join(destination, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(source, file), target);
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', timeout: 10 * 60 * 1000 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.status}`);
}

export function checkInstallation(root, scope) {
  const temporary = mkdtempSync(join(tmpdir(), 'pact-lockfiles-'));
  try {
    copyInstallation(root, temporary, scope);
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], temporary);
    // The existing vulnerability policy is applied independently to each graph.
    run(process.execPath, [join(root, 'scripts/audit-dependencies.mjs')], temporary);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const scope = process.argv[2];
    if (scope && !['root', ...workspaces].includes(scope)) throw new Error('Usage: node scripts/check-dependency-lockfiles.mjs [root|server|web]');
    checkMetadata(repository);
    if (scope) checkInstallation(repository, scope);
    console.log(`Dependency lockfiles passed${scope ? `: isolated ${scope} install and audit` : ': metadata and direct resolution parity'}.`);
  } catch (error) {
    console.error(error.message);
    console.error('See docs/operations/dependabot-workspaces.md; do not bypass npm ci or security checks.');
    process.exitCode = 1;
  }
}
