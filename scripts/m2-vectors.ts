import { readFileSync, writeFileSync } from 'node:fs';
import { authorizationDigest, cancellationDigest, termsHash, type Action } from '../server/src/modules/base/codec';
import { localTerms } from '../server/src/modules/base/fixtures';
const terms = localTerms();
const instance = '0x0000000000000000000000000000000000000999';
const vectors = { version: '2-local-review-2', chainId: '31337', instance, terms,
  termsHash: termsHash(terms), cancellation: cancellationDigest(terms,instance,'31337',1,'0','150'), ...Object.fromEntries((['funding', 'mutual', 'dispute', 'arbitration'] as Action[]).map(action => [action,
    authorizationDigest({ action, terms, chainId: '31337', instance, validUntil: '150', ...(['mutual', 'arbitration'].includes(action) ? { workerAmount: '370001' } : {}) })])) };
const path = 'contracts/evm/test/vectors.json';
const content = JSON.stringify(vectors, null, 2) + '\n';
if (process.argv.includes('--write')) writeFileSync(path, content);
else if (readFileSync(path, 'utf8') !== content) throw new Error('M2 canonical vectors differ');
console.log('M2 TypeScript canonical vectors verified');
