import { randomUUID } from 'node:crypto';

const nodeUrl = process.env.CKB_NODE_URL || 'https://testnet.ckb.dev/';
const deploymentTxHash = process.env.CKB_CONTRACT_DEPLOYMENT_TX_HASH;
const runLifecycle = process.env.CKB_TESTNET_E2E === 'true';

async function rpc(method, params = []) {
  const response = await fetch(nodeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`CKB RPC ${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error || !body.result) throw new Error(`CKB RPC ${method} failed: ${JSON.stringify(body.error)}`);
  return body.result;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when CKB_TESTNET_E2E=true.`);
  return value;
}

function parseScript(name) {
  const value = JSON.parse(required(name));
  if (!value.codeHash || !value.hashType || value.args === undefined) {
    throw new Error(`${name} must be a JSON CKB script with codeHash, hashType, and args.`);
  }
  return value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiRequest(baseUrl, apiKey, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload.data;
}

async function waitFor(label, poll, accept, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await poll();
    if (accept(last)) return last;
    await sleep(5_000);
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms; last state: ${JSON.stringify(last)}`);
}

async function createFundedEscrow(params) {
  const suffix = randomUUID();
  const agreement = await apiRequest(params.baseUrl, params.apiKey, '/v1/agreements', {
    method: 'POST', idempotencyKey: `ckb-e2e-agreement-${suffix}`,
    body: {
      title: `CKB testnet ${params.operation} ${suffix}`,
      clientExternalId: `client-${suffix}`,
      workerExternalId: `worker-${suffix}`,
      totalAmount: params.amount,
      currency: 'CKB',
      releaseMode: 'milestone',
      disputeMode: 'app_managed',
    },
  });
  const milestone = await apiRequest(params.baseUrl, params.apiKey, `/v1/agreements/${agreement.id}/milestones`, {
    method: 'POST', idempotencyKey: `ckb-e2e-milestone-${suffix}`,
    body: { title: `${params.operation} milestone`, amount: params.amount, currency: 'CKB' },
  });
  await apiRequest(params.baseUrl, params.apiKey, `/v1/agreements/${agreement.id}/accept`, {
    method: 'POST', idempotencyKey: `ckb-e2e-accept-${suffix}`, body: {},
  });
  await apiRequest(params.baseUrl, params.apiKey, `/v1/agreements/${agreement.id}/funding-required`, {
    method: 'POST', idempotencyKey: `ckb-e2e-funding-required-${suffix}`, body: {},
  });
  const escrow = await apiRequest(params.baseUrl, params.apiKey, '/v1/escrows', {
    method: 'POST', idempotencyKey: `ckb-e2e-escrow-${suffix}`,
    body: {
      agreementId: agreement.id,
      milestoneId: milestone.id,
      amount: params.amount,
      currency: 'CKB',
      rail: 'ckb',
      network: 'testnet',
      clientLockScript: params.clientLockScript,
      workerLockScript: params.workerLockScript,
      refundTimeoutSince: params.refundTimeoutSince,
    },
  });
  const funded = await waitFor(
    `${params.operation} funding confirmation`,
    () => apiRequest(params.baseUrl, params.apiKey, `/v1/escrows/${escrow.id}/mark-funded`, {
      method: 'POST', idempotencyKey: `ckb-e2e-funding-observation-${randomUUID()}`,
      body: { txHash: escrow.lockTxHash },
    }),
    (value) => value.status === 'funded',
    params.timeoutMs,
  );
  return { suffix, agreement, milestone, escrow: funded };
}

async function runReleaseLifecycle(params) {
  const resources = await createFundedEscrow({
    ...params,
    operation: 'release',
    clientLockScript: params.signerLockScript,
    workerLockScript: params.counterpartyLockScript,
    refundTimeoutSince: params.futureRefundSince,
  });
  const proof = await apiRequest(params.baseUrl, params.apiKey, '/v1/proofs', {
    method: 'POST', idempotencyKey: `ckb-e2e-proof-${resources.suffix}`,
    body: {
      agreementId: resources.agreement.id,
      milestoneId: resources.milestone.id,
      submittedByExternalId: `worker-${resources.suffix}`,
      type: 'text',
      content: 'Controlled CKB testnet release proof.',
    },
  });
  await apiRequest(params.baseUrl, params.apiKey, `/v1/proofs/${proof.id}/review`, {
    method: 'POST', idempotencyKey: `ckb-e2e-review-${resources.suffix}`,
    body: { reviewerExternalId: `client-${resources.suffix}`, decision: 'approved' },
  });
  await apiRequest(params.baseUrl, params.apiKey, `/v1/escrows/${resources.escrow.id}/release`, {
    method: 'POST', idempotencyKey: `ckb-e2e-release-${resources.suffix}`, body: {},
  });
  const settled = await waitFor(
    'release confirmation',
    () => apiRequest(params.baseUrl, params.apiKey, `/v1/escrows/${resources.escrow.id}`),
    (value) => value.status === 'released',
    params.timeoutMs,
  );
  return { agreementId: resources.agreement.id, milestoneId: resources.milestone.id, escrowId: settled.id, txHash: settled.releaseTxHash };
}

async function runRefundLifecycle(params) {
  const resources = await createFundedEscrow({
    ...params,
    operation: 'refund',
    clientLockScript: params.counterpartyLockScript,
    workerLockScript: params.signerLockScript,
    refundTimeoutSince: params.currentTip,
  });
  await apiRequest(params.baseUrl, params.apiKey, `/v1/escrows/${resources.escrow.id}/refund`, {
    method: 'POST', idempotencyKey: `ckb-e2e-refund-${resources.suffix}`, body: {},
  });
  const settled = await waitFor(
    'refund confirmation',
    () => apiRequest(params.baseUrl, params.apiKey, `/v1/escrows/${resources.escrow.id}`),
    (value) => value.status === 'refunded',
    params.timeoutMs,
  );
  return { agreementId: resources.agreement.id, milestoneId: resources.milestone.id, escrowId: settled.id, txHash: settled.refundTxHash };
}

const tip = await rpc('get_tip_header');
if (!tip.hash || !tip.number) throw new Error('CKB testnet tip response is incomplete.');
if (deploymentTxHash) {
  const deployment = await rpc('get_transaction', [deploymentTxHash]);
  if (deployment.tx_status?.status !== 'committed') throw new Error('Configured contract deployment is not committed.');
}

if (!runLifecycle) {
  console.log(JSON.stringify({ status: 'smoke_ok', tipNumber: tip.number, deploymentChecked: Boolean(deploymentTxHash), lifecycleRun: false }));
  process.exit(0);
}
if (process.env.CKB_NETWORK !== 'testnet') throw new Error('CKB_TESTNET_E2E requires CKB_NETWORK=testnet.');

const currentTip = BigInt(tip.number).toString();
const timeoutMs = Number(process.env.CKB_TESTNET_E2E_TIMEOUT_MS || 20 * 60_000);
const params = {
  baseUrl: required('PACTAGENT_API_URL').replace(/\/$/, ''),
  apiKey: required('PACTAGENT_API_KEY'),
  signerLockScript: parseScript('CKB_TESTNET_SIGNER_LOCK_SCRIPT'),
  counterpartyLockScript: parseScript('CKB_TESTNET_COUNTERPARTY_LOCK_SCRIPT'),
  amount: process.env.CKB_TESTNET_ESCROW_AMOUNT || '40000000000',
  currentTip,
  futureRefundSince: (BigInt(currentTip) + BigInt(100)).toString(),
  timeoutMs,
};

const release = await runReleaseLifecycle(params);
const refund = await runRefundLifecycle(params);
console.log(JSON.stringify({ status: 'lifecycle_ok', tipNumber: tip.number, deploymentChecked: Boolean(deploymentTxHash), release, refund }));
