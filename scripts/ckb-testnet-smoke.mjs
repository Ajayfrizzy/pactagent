const nodeUrl = process.env.CKB_NODE_URL || 'https://testnet.ckb.dev/';
const deploymentTxHash = process.env.CKB_CONTRACT_DEPLOYMENT_TX_HASH;

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

const tip = await rpc('get_tip_header');
if (!tip.hash || !tip.number) throw new Error('CKB testnet tip response is incomplete.');
if (deploymentTxHash) {
  const deployment = await rpc('get_transaction', [deploymentTxHash]);
  if (deployment.tx_status?.status !== 'committed') throw new Error('Configured contract deployment is not committed.');
}
console.log(JSON.stringify({ status: 'ok', tipNumber: tip.number, deploymentChecked: Boolean(deploymentTxHash) }));
