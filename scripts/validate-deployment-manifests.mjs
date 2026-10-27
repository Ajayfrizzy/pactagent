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
if (workloads.length !== 4) throw new Error(`Expected three Deployments and one Job, found ${workloads.length}`);
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

const expectedDeployments = ['pactagent-api', 'pactagent-worker-infrastructure', 'pactagent-web'];
const deployments = documents.filter(({ value }) => value.kind === 'Deployment').map(({ value }) => value);
const deploymentNames = deployments.map((deployment) => deployment.metadata.name).sort();
if (JSON.stringify(deploymentNames) !== JSON.stringify([...expectedDeployments].sort())) {
  throw new Error(`Application Deployments do not match the release workflow: ${deploymentNames.join(', ')}`);
}

for (const deployment of deployments) {
  const selector = deployment.spec.selector?.matchLabels;
  const podLabels = deployment.spec.template?.metadata?.labels;
  if (!selector || !podLabels || Object.entries(selector).some(([key, value]) => podLabels[key] !== value)) {
    throw new Error(`${deployment.metadata.name}: Deployment selector does not match pod labels`);
  }
}

const services = documents.filter(({ value }) => value.kind === 'Service').map(({ value }) => value);
for (const service of services) {
  const matches = deployments.filter((deployment) => Object.entries(service.spec.selector || {})
    .every(([key, value]) => deployment.spec.template.metadata.labels?.[key] === value));
  if (matches.length !== 1 || matches[0].metadata.name !== service.metadata.name) {
    throw new Error(`${service.metadata.name}: Service selector must resolve to its matching Deployment`);
  }

  const namedContainerPorts = new Set(matches[0].spec.template.spec.containers
    .flatMap((container) => container.ports || [])
    .map((port) => port.name)
    .filter(Boolean));
  for (const port of service.spec.ports || []) {
    if (typeof port.targetPort === 'string' && !namedContainerPorts.has(port.targetPort)) {
      throw new Error(`${service.metadata.name}: Service targetPort ${port.targetPort} does not exist`);
    }
  }
}

const worker = deployments.find((deployment) => deployment.metadata.name === 'pactagent-worker-infrastructure');
const workerEnvironment = Object.fromEntries(worker.spec.template.spec.containers[0].env
  .filter((entry) => typeof entry.value === 'string')
  .map((entry) => [entry.name, entry.value]));
if (workerEnvironment.WORKER_QUEUES !== 'webhook,settlement') {
  throw new Error('pactagent-worker-infrastructure must process webhook and settlement queues');
}
if (workerEnvironment.OTEL_SERVICE_NAME !== worker.metadata.name) {
  throw new Error('Infrastructure worker OpenTelemetry identity must match its Deployment name');
}

const workflow = YAML.parse(fs.readFileSync('.github/workflows/deploy.yml', 'utf8'));
const deploySteps = workflow.jobs?.deploy?.steps || [];
for (const stepName of [
  'Health-gated rollout and smoke checks',
  'Roll back application workloads on failed promotion',
]) {
  const step = deploySteps.find((candidate) => candidate.name === stepName);
  const targets = [...String(step?.run || '').matchAll(/^\s+(pactagent-[a-z0-9-]+)\s*\\?\s*$/gm)]
    .map((match) => match[1]);
  if (JSON.stringify(targets) !== JSON.stringify(expectedDeployments)) {
    throw new Error(`${stepName}: expected ${expectedDeployments.join(', ')}, found ${targets.join(', ')}`);
  }
}
process.stdout.write(`Validated ${documents.length} Kubernetes resources.\n`);
