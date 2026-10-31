import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const digest = data => createHash('sha256').update(data).digest('hex');
const artifacts = ['PactEscrow', 'PactFactory'].map(name => {
  const data = JSON.parse(readFileSync(`contracts/evm/out/${name}.sol/${name}.json`, 'utf8'));
  return { name, abi: data.abi, abiSha256: digest(JSON.stringify(data.abi)),
    creationTemplateSha256: digest(Buffer.from(data.bytecode.object.replace(/^0x/, ''), 'hex')),
    runtimeTemplateSha256: digest(Buffer.from(data.deployedBytecode.object.replace(/^0x/, ''), 'hex')),
    runtimeTemplateBytes: data.deployedBytecode.object.replace(/^0x/, '').length / 2,
    immutableReferences: data.deployedBytecode.immutableReferences };
});
const output = JSON.stringify({ status: 'local-review-not-deployable', compiler: '0.8.30', foundry: '1.3.1', evm: 'cancun', optimizerRuns: 200, viaIR: true,
  note: 'SHA-256 reproducibility evidence, not Keccak deployment identity; constructor immutables differ per instance.', artifacts }, null, 2) + '\n';
const path = 'docs/architecture/evidence/m2/local-contract-artifacts.json';
if (process.argv.includes('--write')) writeFileSync(path, output);
else if (readFileSync(path, 'utf8') !== output) throw new Error('Contract artifacts differ from reviewed candidate');
console.log('M2 ABI and bytecode templates reproduced');
