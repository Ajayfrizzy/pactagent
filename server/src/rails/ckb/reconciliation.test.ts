import assert from 'node:assert/strict';
import test from 'node:test';
import type { CkbRailConfig } from './network-config';
import { CkbReconciliationService } from './reconciliation';
import type { CkbNodeRpcClient, CkbTransactionResponse } from './rpc';

const railConfig: CkbRailConfig = {
  enabled: true,
  network: 'testnet',
  nodeUrl: 'https://node.example.test',
  indexerUrl: 'https://indexer.example.test',
  contract: {
    codeHash: `0x${'1'.repeat(64)}`,
    hashType: 'type',
    deploymentTxHash: `0x${'2'.repeat(64)}`,
    outputIndex: 0,
    depType: 'code',
    version: 1,
  },
  confirmations: 4,
  feeRate: 1200n,
};

const lock = { code_hash: `0x${'3'.repeat(64)}`, hash_type: 'type' as const, args: '0x01' };
const txHash = `0x${'4'.repeat(64)}`;

function nodeWith(response: CkbTransactionResponse | null, tip = '0x13') {
  return {
    getTransaction: async () => response,
    getTipHeader: async () => ({ hash: `0x${'5'.repeat(64)}`, number: tip }),
  } as unknown as CkbNodeRpcClient;
}

test('CKB reconciliation calculates confirmation depth and verifies exact funding commitment', async () => {
  const response: CkbTransactionResponse = {
    transaction: {
      version: '0x0',
      cell_deps: [],
      header_deps: [],
      inputs: [],
      outputs: [{ capacity: '0x64', lock }],
      outputs_data: ['0x0102'],
      witnesses: [],
    },
    tx_status: { status: 'committed', block_hash: `0x${'6'.repeat(64)}`, block_number: '0x10' },
  };
  const service = new CkbReconciliationService(railConfig, nodeWith(response));
  const observed = await service.verifyFunding({
    txHash,
    outputIndex: 0,
    lockScript: lock,
    cellData: '0x0102',
    amount: '100',
  });
  assert.equal(observed.status, 'confirmed');
  assert.equal(observed.confirmations, 4);
  assert.equal(observed.blockNumber, '16');
});

test('CKB reconciliation rejects substituted script, data, and amount', async () => {
  const response: CkbTransactionResponse = {
    transaction: {
      version: '0x0', cell_deps: [], header_deps: [], inputs: [], witnesses: [],
      outputs: [{ capacity: '0x64', lock }], outputs_data: ['0x0102'],
    },
    tx_status: { status: 'committed', block_number: '0x10' },
  };
  const service = new CkbReconciliationService(railConfig, nodeWith(response));
  await assert.rejects(() => service.verifyFunding({
    txHash, outputIndex: 0, lockScript: { ...lock, args: '0x02' }, cellData: '0x0102', amount: '100',
  }), /does not match/);
  await assert.rejects(() => service.verifyFunding({
    txHash, outputIndex: 0, lockScript: lock, cellData: '0x0103', amount: '100',
  }), /does not match/);
  await assert.rejects(() => service.verifyFunding({
    txHash, outputIndex: 0, lockScript: lock, cellData: '0x0102', amount: '101',
  }), /does not exactly match/);
});

test('CKB reconciliation verifies one escrow input and one exact settlement output', async () => {
  const response: CkbTransactionResponse = {
    transaction: {
      version: '0x0', cell_deps: [], header_deps: [], witnesses: [], outputs_data: ['0x', '0x'],
      inputs: [{ previous_output: { tx_hash: txHash, index: '0x0' }, since: '0x0' }],
      outputs: [
        { capacity: '0x64', lock },
        { capacity: '0x3d090000', lock: { ...lock, args: '0xfee' } },
      ],
    },
    tx_status: { status: 'committed', block_number: '0x10' },
  };
  const service = new CkbReconciliationService(railConfig, nodeWith(response));
  const observed = await service.verifySettlement({
    txHash: `0x${'7'.repeat(64)}`,
    lockTxHash: txHash,
    lockOutputIndex: 0,
    destinationLockScript: lock,
    amount: '100',
  });
  assert.equal(observed.status, 'confirmed');

  response.transaction!.inputs = [];
  await assert.rejects(() => service.verifySettlement({
    txHash: `0x${'7'.repeat(64)}`, lockTxHash: txHash, lockOutputIndex: 0, destinationLockScript: lock, amount: '100',
  }), /does not spend exactly/);

  response.transaction!.inputs = [{ previous_output: { tx_hash: txHash, index: '0x0' }, since: '0x0' }];
  response.transaction!.outputs.push({ capacity: '0x64', lock });
  await assert.rejects(() => service.verifySettlement({
    txHash: `0x${'7'.repeat(64)}`, lockTxHash: txHash, lockOutputIndex: 0, destinationLockScript: lock, amount: '100',
  }), /one exact escrow destination/);
});
