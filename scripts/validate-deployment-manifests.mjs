import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const YAML = require('yaml');
const files = [
  'deploy/kubernetes/platform.yaml',
  'deploy/kubernetes/services.yaml',
  'deploy/kubernetes/migration-job.yaml',
  'deploy/kubernetes/workloads.yaml',
];
const documents = files.flatMap((file) => YAML.parseAllDocuments(fs.readFileSync(file, 'utf8')).map((document) => {
  if (document.errors.length) throw new Error(`${file}: ${document.errors.join('; ')}`);
  return { file, value: document.toJSON() };
})).filter((entry) => entry.value);

const workloads = documents.filter(({ value }) => ['Deployment', 'Job'].includes(value.kind));
if (workloads.length !== 6) throw new Error(`Expected five Deployments and one Job, found ${workloads.length}`);
for (const { file, value } of workloads) {
  const spec = value.kind === 'Job' ? value.spec.template.spec : value.spec.template.spec;
  if (spec.automountServiceAccountToken !== false) throw new Error(`${file}/${value.metadata.name}: service account token must be disabled`);
  for (const container of spec.containers || []) {
    if (!container.resources?.requests || !container.resources?.limits) throw new Error(`${value.metadata.name}: resource bounds missing`);
    if (!container.securityContext?.readOnlyRootFilesystem || container.securityContext?.allowPrivilegeEscalation !== false) {
      throw new Error(`${value.metadata.name}: container security context missing`);
    }
    if (!String(container.image).includes('IMAGE_')) throw new Error(`${value.metadata.name}: immutable image placeholder missing`);
  }
  if (value.kind === 'Deployment' && !spec.terminationGracePeriodSeconds) throw new Error(`${value.metadata.name}: termination grace period missing`);
}
process.stdout.write(`Validated ${documents.length} Kubernetes resources.\n`);
