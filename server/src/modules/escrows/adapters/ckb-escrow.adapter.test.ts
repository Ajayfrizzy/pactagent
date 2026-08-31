import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScriptLike } from '@ckb-ccc/core';
import { config } from '../../../config';
import type { CkbNodeRpcClient } from '../../../rails/ckb/rpc';
import type { CkbSignerProvider } from '../../../rails/ckb/signer-provider';
import { CkbEscrowAdapter } from './ckb-escrow.adapter';

const clientLock = { codeHash: `0x${'3'.repeat(64)}`, hashType: 'type' as const, args: '0x01' };
const workerLock = { codeHash: `0x${'4'.repeat(64)}`, hashType: 'type' as const, args: '0x02' };
const expectedHash = `0x${'5'.repeat(64)}`;

function signer(): CkbSignerProvider {
  return {
    getAddress: async () => 'ckt1-test',
    getLockScript: async () => clientLock as ScriptLike,
    signEscrowLock: async () => ({
      transaction: { version: '0x0', cell_deps: [], header_deps: [], inputs: [], outputs: [], outputs_data: [], witnesses: [] },
      txHash: expectedHash,
    }),
    signSettlement: async () => ({
      transaction: { version: '0x0', cell_deps: [], header_deps: [], inputs: [], outputs: [], outputs_data: [], witnesses: [] },
      txHash: expectedHash,
    }),
  };
}

async function withCkbConfig(run: () => Promise<void>) {
  const original = {
    ckbRailEnabled: config.ckbRailEnabled,
    ckbNetwork: config.ckbNetwork,
    ckbIndexerUrl: config.ckbIndexerUrl,
    ckbContractCodeHash: config.ckbContractCodeHash,
    ckbContractHashType: config.ckbContractHashType,
    ckbContractDeploymentTxHash: config.ckbContractDeploymentTxHash,
    ckbContractDepType: config.ckbContractDepType,
    ckbSignerMode: config.ckbSignerMode,
    ckbSignerPrivateKey: config.ckbSignerPrivateKey,
  };
  Object.assign(config, {
    ckbRailEnabled: true,
    ckbNetwork: 'testnet',
    ckbIndexerUrl: 'https://indexer.example.test',
    ckbContractCodeHash: `0x${'1'.repeat(64)}`,
    ckbContractHashType: 'type',
    ckbContractDeploymentTxHash: `0x${'2'.repeat(64)}`,
    ckbContractDepType: 'code',
    ckbSignerMode: 'local_dev',
    ckbSignerPrivateKey: `0x${'6'.repeat(64)}`,
  });
  try {
    await run();
  } finally {
    Object.assign(config, original);
  }
}

test('CKB ambiguous broadcast persists the deterministic expected hash for reconciliation', async () => {
  await withCkbConfig(async () => {
    const node = { sendTransaction: async () => { throw new Error('connection closed after send'); } } as unknown as CkbNodeRpcClient;
    const adapter = new CkbEscrowAdapter({ signer: signer(), node });
    const result = await adapter.createEscrowLock({
      escrowId: 'escrow-1', appId: 'app-1', agreementId: 'agreement-1', milestoneId: 'milestone-1',
      amount: '30000000000', currency: 'CKB', rail: 'ckb', network: 'testnet', milestoneIndex: 1,
      clientLockScript: clientLock, workerLockScript: workerLock, refundTimeoutSince: '12345',
    });
    assert.equal(result.status, 'reconciliation_required');
    assert.equal(result.txHash, expectedHash);
    assert.match(JSON.stringify(result.rawPayload), /connection closed after send/);
  });
});

test('CKB adapter rejects a persisted network that differs from process configuration', async () => {
  await withCkbConfig(async () => {
    const node = { sendTransaction: async () => expectedHash } as unknown as CkbNodeRpcClient;
    const adapter = new CkbEscrowAdapter({ signer: signer(), node });
    await assert.rejects(() => adapter.createEscrowLock({
      escrowId: 'escrow-1', appId: 'app-1', agreementId: 'agreement-1', milestoneId: 'milestone-1',
      amount: '30000000000', currency: 'CKB', rail: 'ckb', network: 'mainnet', milestoneIndex: 1,
      clientLockScript: clientLock, workerLockScript: workerLock, refundTimeoutSince: '12345',
    }), /does not match configured network/);
  });
});
