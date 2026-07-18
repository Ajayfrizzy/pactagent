import { readFileSync } from 'fs';

const [baselinePath, candidatePath = 'docs/openapi/pactagent.v1.openapi.json'] = process.argv.slice(2);
if (!baselinePath) throw new Error('Usage: npm run openapi:compat -- <baseline.json> [candidate.json]');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
const methods = ['get', 'post', 'put', 'patch', 'delete'];
const breaking: string[] = [];
for (const [path, pathItem] of Object.entries(baseline.paths || {}) as Array<[string, any]>) {
  if (!candidate.paths?.[path]) {
    breaking.push(`removed path ${path}`);
    continue;
  }
  for (const method of methods) {
    if (pathItem[method] && !candidate.paths[path][method]) breaking.push(`removed operation ${method.toUpperCase()} ${path}`);
  }
}
if (breaking.length) throw new Error(`Breaking OpenAPI changes require a new major API version:\n${breaking.join('\n')}`);
console.log('No removed v1 paths or operations detected.');
