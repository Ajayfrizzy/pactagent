import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const YAML = require('yaml');
const compose = YAML.parse(fs.readFileSync('deploy/docker-compose.vps.yml', 'utf8'));
const services = compose.services || {};
for (const name of ['api', 'web', 'worker', 'redis', 'migrate']) if (!services[name]) throw new Error(`Compose service missing: ${name}`);
for (const name of ['api', 'web', 'worker', 'redis']) {
  if (services[name].restart !== 'unless-stopped') throw new Error(`${name} must restart unless-stopped`);
  if (!services[name].healthcheck) throw new Error(`${name} healthcheck missing`);
}
if (services.redis.ports) throw new Error('Redis must not publish ports');
for (const name of ['api', 'web']) if (!String(services[name].ports?.[0] || '').startsWith('127.0.0.1:')) throw new Error(`${name} must bind privately`);
for (const name of ['api', 'worker', 'migrate']) if (!String(services[name].image || '').includes('PACTAGENT_')) throw new Error(`${name} must use release image variables`);
const workflowText = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
const workflow = YAML.parse(workflowText);
if (workflowText.includes('kubectl') || workflowText.includes('KUBECONFIG_B64')) throw new Error('Active workflow still depends on Kubernetes');
if (!workflowText.includes('docker-compose.vps.yml') || !workflowText.includes('ssh')) throw new Error('SSH Compose deployment is missing');
if (!workflow.jobs?.publish || !workflow.jobs?.deploy) throw new Error('Publish and deploy jobs are required');
process.stdout.write('Validated VPS Compose services and SSH deployment workflow.\n');
