import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const catalog = JSON.parse(fs.readFileSync('config/operations-exercises.json', 'utf8'));
const id = process.argv.find((argument) => argument.startsWith('--exercise='))?.split('=')[1];
if (!id) {
  process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
  process.exit(0);
}
const exercise = catalog.exercises.find((item) => item.id === id);
if (!exercise) throw new Error(`Unknown exercise: ${id}`);
if (!process.argv.includes('--execute')) {
  process.stdout.write(`${JSON.stringify({ mode: 'dry-run', ...exercise }, null, 2)}\n`);
  process.exit(0);
}
const startedAt = new Date().toISOString();
const result = spawnSync(exercise.command, { shell: true, stdio: 'inherit' });
const evidence = { exercise: id, owner: exercise.owner, startedAt, completedAt: new Date().toISOString(), exitCode: result.status, expectedEvidence: exercise.expectedEvidence, abortCondition: exercise.abortCondition };
fs.mkdirSync('artifacts/exercises', { recursive: true });
fs.writeFileSync(`artifacts/exercises/${id}-${Date.now()}.json`, `${JSON.stringify(evidence, null, 2)}\n`);
process.exitCode = result.status ?? 1;
