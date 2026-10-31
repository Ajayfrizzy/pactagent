import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const connection = process.env.M1_TEST_DATABASE_URL;
if (!connection) throw new Error('M1_TEST_DATABASE_URL is required; use an EMPTY disposable local pactagent_m1_upgrade database.');
const url = new URL(connection);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/pactagent_m1_upgrade') {
  throw new Error('Only local disposable pactagent_m1_upgrade is permitted.');
}
const root = resolve(import.meta.dirname, '../server/prisma');
const run = (args) => {
  const result = spawnSync('psql', [connection, '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'psql failed');
  return result.stdout;
};
if (run(['-Atc', "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"]).trim() !== '0') throw new Error('Database must be empty; never reset an existing database.');
const migration = '20261031000100_multichain_foundation';
for (const name of readdirSync(`${root}/migrations`).sort().filter((name) => name < migration)) {
  run(['-f', `${root}/migrations/${name}/migration.sql`]);
}
run(['-f', `${root}/fixtures/m1-upgrade.sql`]);
run(['-f', `${root}/migrations/${migration}/migration.sql`]);
run(['-f', `${root}/fixtures/m1-upgrade-verify.sql`]);
console.log('PASS: populated pre-M1 CKB/manual/mock upgrade; all legacy row bytes preserved; old reader/writer compatibility.');
