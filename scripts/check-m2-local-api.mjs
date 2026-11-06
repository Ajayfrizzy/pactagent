import SwaggerParser from '@apidevtools/swagger-parser';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const doc=await SwaggerParser.validate('server/docs/openapi/pactagent.v2.local.openapi.json');
assert.equal(Object.keys(doc.paths).length,4);
assert.doesNotMatch(readFileSync('server/src/app.ts','utf8'),/localFinancialRouter|local-api/);
assert.equal(doc.servers[0].url,'http://127.0.0.1:3001/v2/local/base');
console.log('Local M2 OpenAPI valid; financial harness is not mounted by the runtime app.');
