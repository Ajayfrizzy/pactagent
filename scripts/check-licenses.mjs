import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizeExpression(value) {
  return String(value || '')
    .replace(/[()]/g, ' ')
    .replace(/\s+(AND|OR|WITH)\s+/gi, '|')
    .split('|')
    .map((item) => item.trim().replace(/\+$/, '-or-later'))
    .filter(Boolean);
}

function packageDirectories(nodeModulesPath, found, visited) {
  if (!existsSync(nodeModulesPath)) return;
  const realPath = realpathSync(nodeModulesPath);
  if (visited.has(realPath)) return;
  visited.add(realPath);

  for (const entry of readdirSync(nodeModulesPath)) {
    if (entry.startsWith('.') || entry === '.bin') continue;
    const entryPath = resolve(nodeModulesPath, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    if (entry.startsWith('@')) {
      for (const scopedEntry of readdirSync(entryPath)) {
        const packagePath = resolve(entryPath, scopedEntry);
        if (statSync(packagePath).isDirectory()) found.add(packagePath);
      }
      continue;
    }

    found.add(entryPath);
  }

  for (const packagePath of [...found]) {
    const nested = resolve(packagePath, 'node_modules');
    if (existsSync(nested)) packageDirectories(nested, found, visited);
  }
}

export function checkLicenses({ root = repositoryRoot, scanPaths, policyPath } = {}) {
  const policy = readJson(policyPath || resolve(root, 'config/license-policy.json'));
  const allowed = new Set(policy.allowed || []);
  const denied = new Set(policy.denied || []);
  const exceptions = policy.exceptions || {};
  const packagePaths = new Set();
  const visited = new Set();
  const paths = scanPaths || ['node_modules', 'server/node_modules', 'web/node_modules'];

  for (const path of paths) {
    packageDirectories(resolve(root, path), packagePaths, visited);
  }

  const failures = [];
  const reviewed = [];
  for (const packagePath of [...packagePaths].sort()) {
    const manifestPath = resolve(packagePath, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    const identity = `${manifest.name || packagePath}@${manifest.version || 'unknown'}`;
    const exception = exceptions[identity] || exceptions[manifest.name];
    const expression = manifest.license?.type || manifest.license || manifest.licenses?.map((item) => item.type || item).join(' OR ');
    const licenses = normalizeExpression(expression);

    if (exception) {
      if (!exception.reason || !exception.expires) {
        failures.push(`${identity}: exception must include reason and expires`);
        continue;
      }
      if (Date.parse(exception.expires) < Date.now()) {
        failures.push(`${identity}: license exception expired on ${exception.expires}`);
        continue;
      }
      reviewed.push({ identity, license: expression || 'UNKNOWN', exception: exception.reason });
      continue;
    }

    if (licenses.length === 0) {
      failures.push(`${identity}: missing license metadata`);
      continue;
    }
    if (licenses.some((license) => denied.has(license))) {
      failures.push(`${identity}: explicitly denied license ${expression}`);
      continue;
    }
    if (licenses.some((license) => !allowed.has(license))) {
      failures.push(`${identity}: unapproved license ${expression}`);
      continue;
    }
    reviewed.push({ identity, license: expression });
  }

  if (reviewed.length === 0) failures.push('No installed dependency manifests were found. Run npm ci first.');
  return { failures, reviewed };
}

function main() {
  const result = checkLicenses();
  if (result.failures.length > 0) {
    console.error('Dependency license policy failed:');
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log(`Dependency license policy passed for ${result.reviewed.length} installed packages.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
