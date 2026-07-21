const apiUrl = process.env.SMOKE_API_URL?.replace(/\/$/, '');
const webUrl = process.env.SMOKE_WEB_URL?.replace(/\/$/, '');
const expectedCommit = process.env.EXPECTED_COMMIT;

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function dataOf(body) {
  return body?.data ?? body;
}

export function validateHealth(body, commit = expectedCommit) {
  const data = dataOf(body);
  if (data.status !== 'ok') throw new Error(`API liveness is ${data.status ?? 'missing'}`);
  if (commit && data.commit !== commit) throw new Error(`API commit ${data.commit} does not match ${commit}`);
}

export function validateReadiness(body, commit = expectedCommit) {
  const data = dataOf(body);
  if (data.status !== 'ready') throw new Error(`API readiness is ${data.status ?? 'missing'}`);
  if (data.database !== 'ok') throw new Error('Database smoke check failed');
  if (data.worker?.status !== 'ok') throw new Error(`Worker smoke check is ${data.worker?.status ?? 'missing'}`);
  if (!Number.isInteger(data.worker?.queuedJobs) || !Number.isInteger(data.worker?.deadLetterJobs)) {
    throw new Error('Queue smoke fields are missing');
  }
  if (!['ok', 'not_required'].includes(data.settlement?.status)) throw new Error('Settlement provider smoke check failed');
  if (commit && data.commit !== commit) throw new Error(`Ready commit ${data.commit} does not match ${commit}`);
}

export async function runDeploymentSmoke() {
  if (!apiUrl || !webUrl) throw new Error('SMOKE_API_URL and SMOKE_WEB_URL are required');
  validateHealth(await getJson(`${apiUrl}/health`));
  validateReadiness(await getJson(`${apiUrl}/ready`));
  const web = await fetch(`${webUrl}/`, { signal: AbortSignal.timeout(10_000) });
  if (!web.ok) throw new Error(`Web smoke check returned HTTP ${web.status}`);
  process.stdout.write('API, worker, database, queue, settlement, and web smoke checks passed.\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDeploymentSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
