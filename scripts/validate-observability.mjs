import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const YAML = require('yaml');
const collector = YAML.parse(fs.readFileSync('observability/otel-collector.yaml', 'utf8'));
const alerts = YAML.parse(fs.readFileSync('observability/prometheus/alerts.yaml', 'utf8'));
for (const pipeline of ['traces', 'metrics']) {
  if (!collector.service?.pipelines?.[pipeline]) throw new Error(`Collector ${pipeline} pipeline is missing`);
}
if (!collector.processors?.memory_limiter || !collector.processors?.batch) throw new Error('Collector safety processors are missing');
const rules = (alerts.groups || []).flatMap((group) => group.rules || []);
if (rules.length < 8) throw new Error('Alert definition coverage is incomplete');
for (const rule of rules) {
  if (!rule.alert || !rule.expr || !rule.for || !rule.labels?.severity || !rule.annotations?.summary) throw new Error(`Alert rule is incomplete: ${JSON.stringify(rule)}`);
  if (!String(rule.expr).includes('pactagent_')) throw new Error(`${rule.alert} does not query PactAgent metrics`);
}
const dashboardDirectory = 'observability/dashboards';
const dashboardFiles = fs.readdirSync(dashboardDirectory).filter((file) => file.endsWith('.json'));
if (dashboardFiles.length !== 7) throw new Error(`Expected seven dashboards, found ${dashboardFiles.length}`);
const uids = new Set();
for (const file of dashboardFiles) {
  const dashboard = JSON.parse(fs.readFileSync(path.join(dashboardDirectory, file), 'utf8'));
  if (!dashboard.title || !dashboard.uid || !Array.isArray(dashboard.panels) || dashboard.panels.length === 0) throw new Error(`${file} is not a usable Grafana dashboard`);
  if (uids.has(dashboard.uid)) throw new Error(`Duplicate dashboard UID: ${dashboard.uid}`);
  uids.add(dashboard.uid);
  for (const panel of dashboard.panels) for (const target of panel.targets || []) {
    if (!String(target.expr).includes('pactagent_')) throw new Error(`${file}/${panel.title} has an invalid metric query`);
  }
}
process.stdout.write(`Validated collector pipelines, ${rules.length} alerts, and ${dashboardFiles.length} dashboards.\n`);
