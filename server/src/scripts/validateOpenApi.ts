import SwaggerParser from '@apidevtools/swagger-parser';
import listEndpoints from 'express-list-endpoints';
import { resolve } from 'path';
import { createApp } from '../app';

async function main() {
  const specificationPath = resolve('docs/openapi/pactagent.v1.openapi.json');
  const specification = await SwaggerParser.validate(specificationPath) as any;
  const documented = new Set<string>();
  for (const [path, pathItem] of Object.entries(specification.paths || {}) as Array<[string, any]>) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (pathItem[method]) documented.add(`${method.toUpperCase()} ${path.replace(/\{([^}]+)\}/g, ':$1')}`);
    }
  }

  const implemented = new Set<string>();
  for (const endpoint of listEndpoints(createApp())) {
    for (const method of endpoint.methods) implemented.add(`${method.toUpperCase()} ${endpoint.path}`);
  }

  const missingRoutes = [...documented].filter((operation) => !implemented.has(operation));
  if (missingRoutes.length) throw new Error(`OpenAPI operations without an Express route:\n${missingRoutes.join('\n')}`);
  const undocumentedRoutes = [...implemented]
    .filter((operation) => operation.includes(' /v1/'))
    .filter((operation) => !documented.has(operation));
  if (undocumentedRoutes.length) throw new Error(`Express /v1 routes missing from OpenAPI:\n${undocumentedRoutes.join('\n')}`);
  console.log(`Validated ${documented.size} OpenAPI operations against the Express route table.`);
}
void main();
