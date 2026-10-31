import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const correction = process.argv[2] === '--review-correction';
if (process.argv.length > 3 || (process.argv[2] && !correction)) throw new Error('Unknown upgrade fixture option.');
const database = correction ? 'pactagent_m1_review_upgrade' : 'pactagent_m1_upgrade';
const fixture = correction ? 'm1-review-upgrade' : 'm1-upgrade';
const connection = process.env.M1_TEST_DATABASE_URL;
if (!connection) throw new Error(`M1_TEST_DATABASE_URL is required; use an EMPTY disposable local ${database} database.`);
const url = new URL(connection);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== `/${database}`) {
  throw new Error(`Only local disposable ${database} is permitted.`);
}
const root = resolve(import.meta.dirname, '../server/prisma');
const run = (args) => {
  const result = spawnSync('psql', [connection, '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'psql failed');
  return result.stdout;
};
if (run(['-Atc', "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"]).trim() !== '0') throw new Error('Database must be empty; never reset an existing database.');
const migration = correction ? '20261031000200_foundation_exact_fees_and_locking' : '20261031000100_multichain_foundation';
for (const name of readdirSync(`${root}/migrations`).sort().filter((name) => name < migration)) {
  run(['-f', `${root}/migrations/${name}/migration.sql`]);
}
run(['-f', `${root}/fixtures/${fixture}.sql`]);
for (const name of readdirSync(`${root}/migrations`).sort().filter((name) => /^\d/.test(name) && name >= migration)) {
  run(['-f', `${root}/migrations/${name}/migration.sql`]);
}
run(['-f', `${root}/fixtures/${fixture}-verify.sql`]);
console.log(correction
  ? 'PASS: populated M1 forward correction; all existing row bytes preserved; exact fee constraint validated.'
  : 'PASS: populated pre-M1 CKB/manual/mock upgrade; all legacy row bytes preserved; old reader/writer compatibility.');
