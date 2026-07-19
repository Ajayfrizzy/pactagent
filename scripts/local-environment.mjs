import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';

const action = process.argv[2];
const compose = ['compose', '-f', 'compose.dev.yaml'];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function resetFixtures() {
  run('docker', [...compose, 'exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'pactagent', '-d', 'pactagent', '-f', '/dev/stdin'], {
    input: readFileSync('server/test/fixtures/deterministic.sql'),
  });
}

if (action === 'setup') {
  if (!existsSync('server/.env')) copyFileSync('server/.env.example', 'server/.env');
  run('docker', [...compose, '--profile', 'redis', 'up', '-d', '--wait']);
  run('npm', ['run', 'db:generate', '--workspace', '@pact-agent/server']);
  run('npm', ['run', 'db:migrate:deploy', '--workspace', '@pact-agent/server'], {
    env: { ...process.env, DATABASE_URL: 'postgresql://pactagent:pactagent@127.0.0.1:5432/pactagent' },
  });
  resetFixtures();
} else if (action === 'fixtures') {
  resetFixtures();
} else if (action === 'teardown') {
  run('docker', [...compose, '--profile', 'redis', 'down', '--volumes', '--remove-orphans']);
} else {
  console.error('Usage: node scripts/local-environment.mjs <setup|fixtures|teardown>');
  process.exit(2);
}
