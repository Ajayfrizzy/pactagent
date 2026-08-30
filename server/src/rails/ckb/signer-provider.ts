import {
  ClientPublicTestnet,
  Script,
  SignerCkbPrivateKey,
  Transaction,
  type ScriptLike,
} from '@ckb-ccc/core';
import { config } from '../../config';
import { invalidRequest } from '../../common/errors/app-error';
import type { CkbRailConfig } from './network-config';
import type { CkbIndexerCell, CkbRpcScript, CkbRpcTransaction } from './rpc';
import { CkbIndexerRpcClient } from './rpc';
import type { CkbEscrowCommitment } from './transaction-builder';

export type SignedCkbTransaction = {
  transaction: CkbRpcTransaction;
  txHash: string;
};

export interface CkbSignerProvider {
  getAddress(): Promise<string>;
  getLockScript(): Promise<ScriptLike>;
  signEscrowLock(commitment: CkbEscrowCommitment): Promise<SignedCkbTransaction>;
  signSettlement(intent: {
    escrowOutPoint: { txHash: string; index: number };
    amount: bigint;
    destinationLock: ScriptLike;
    authorizerLock: ScriptLike;
    since: bigint;
    contractCellDep: { outPoint: { txHash: string; index: number }; depType: 'code' | 'depGroup' };
  }): Promise<SignedCkbTransaction>;
}

function hex(value: bigint) {
  return `0x${value.toString(16)}`;
}

function rpcScript(scriptLike: ScriptLike): CkbRpcScript {
  const script = Script.from(scriptLike);
  return {
    code_hash: script.codeHash,
    hash_type: script.hashType,
    args: script.args,
  };
}

function rpcTransaction(tx: Transaction): CkbRpcTransaction {
  return {
    version: hex(tx.version),
    cell_deps: tx.cellDeps.map((dep) => ({
      out_point: { tx_hash: dep.outPoint.txHash, index: hex(dep.outPoint.index) },
      dep_type: dep.depType === 'depGroup' ? 'dep_group' : 'code',
    })),
    header_deps: tx.headerDeps,
    inputs: tx.inputs.map((input) => ({
      previous_output: {
        tx_hash: input.previousOutput.txHash,
        index: hex(input.previousOutput.index),
      },
      since: hex(input.since),
    })),
    outputs: tx.outputs.map((output) => ({
      capacity: hex(output.capacity),
      lock: rpcScript(output.lock),
      type: output.type ? rpcScript(output.type) : null,
    })),
    outputs_data: tx.outputsData,
    witnesses: tx.witnesses,
  };
}

export class LocalDevCkbSignerProvider implements CkbSignerProvider {
  private readonly client;
  private readonly signer;
  private readonly indexer;

  constructor(private readonly railConfig: CkbRailConfig, privateKey: string) {
    if (railConfig.network === 'mainnet') {
      throw new Error('Local CKB signing is disabled on mainnet.');
    }
    this.client = new ClientPublicTestnet({ url: railConfig.nodeUrl });
    this.signer = new SignerCkbPrivateKey(this.client, privateKey);
    this.indexer = new CkbIndexerRpcClient(railConfig.indexerUrl);
  }

  getAddress() {
    return this.signer.getRecommendedAddress();
  }

  async getLockScript() {
    return (await this.signer.getRecommendedAddressObj()).script;
  }

  private async collectCapacity(lock: ScriptLike, required: bigint) {
    const cells: CkbIndexerCell[] = [];
    let capacity = BigInt(0);
    let cursor: string | undefined;
    do {
      const page = await this.indexer.getCells(rpcScript(lock), 100, cursor);
      for (const cell of page.objects) {
        if (cell.output.type || cell.output_data !== '0x') continue;
        cells.push(cell);
        capacity += BigInt(cell.output.capacity);
        if (capacity >= required) return { cells, capacity };
      }
      if (!page.last_cursor || page.last_cursor === cursor || page.objects.length === 0) break;
      cursor = page.last_cursor;
    } while (cells.length < 1_000);
    throw invalidRequest('CKB signer has insufficient live capacity.', 'ckb_insufficient_capacity');
  }

  private async prepareAndSign(params: {
    inputs: Array<{ previousOutput: { txHash: string; index: bigint }; since?: bigint }>;
    outputs: Array<{ capacity: bigint; lock: ScriptLike }>;
    outputsData: string[];
    changeIndex: number;
    fixedOutputCapacity: bigint;
    inputCapacity: bigint;
    cellDeps?: Array<{ outPoint: { txHash: string; index: number }; depType: 'code' | 'depGroup' }>;
  }) {
    const tx = Transaction.from({
      inputs: params.inputs,
      outputs: params.outputs,
      outputsData: params.outputsData,
      cellDeps: params.cellDeps ?? [],
    });
    const prepared = await this.signer.prepareTransaction(tx);
    const fee = prepared.estimateFee(this.railConfig.feeRate);
    const changeCapacity = params.inputCapacity - params.fixedOutputCapacity - fee;
    const changeOutput = prepared.outputs[params.changeIndex];
    if (!changeOutput || changeCapacity < BigInt(changeOutput.occupiedSize) * BigInt(100_000_000)) {
      throw invalidRequest('CKB signer change capacity is insufficient after fees.', 'ckb_insufficient_capacity');
    }
    changeOutput.capacity = changeCapacity;
    const signed = await this.signer.signOnlyTransaction(prepared);
    return { transaction: rpcTransaction(signed), txHash: signed.hash() };
  }

  async signEscrowLock(commitment: CkbEscrowCommitment) {
    const signerLock = await this.getLockScript();
    const minimumChange = BigInt(61) * BigInt(100_000_000);
    const feeBudget = this.railConfig.feeRate * BigInt(10);
    const selected = await this.collectCapacity(signerLock, BigInt(commitment.amount) + minimumChange + feeBudget);
    return this.prepareAndSign({
      inputs: selected.cells.map((cell) => ({
        previousOutput: { txHash: cell.out_point.tx_hash, index: BigInt(cell.out_point.index) },
      })),
      outputs: [
        { capacity: BigInt(commitment.amount), lock: commitment.lockScript },
        { capacity: selected.capacity - BigInt(commitment.amount), lock: signerLock },
      ],
      outputsData: [commitment.cellData, '0x'],
      changeIndex: 1,
      fixedOutputCapacity: BigInt(commitment.amount),
      inputCapacity: selected.capacity,
    });
  }

  async signSettlement(intent: Parameters<CkbSignerProvider['signSettlement']>[0]) {
    const signerLock = await this.getLockScript();
    if (!Script.from(signerLock).eq(intent.authorizerLock)) {
      throw invalidRequest('Configured CKB signer is not the required settlement participant.', 'ckb_signer_mismatch');
    }
    const minimumChange = BigInt(61) * BigInt(100_000_000);
    const feeBudget = this.railConfig.feeRate * BigInt(10);
    const feeInputs = await this.collectCapacity(signerLock, minimumChange + feeBudget);
    return this.prepareAndSign({
      inputs: [
        { previousOutput: { txHash: intent.escrowOutPoint.txHash, index: BigInt(intent.escrowOutPoint.index) }, since: intent.since },
        ...feeInputs.cells.map((cell) => ({
          previousOutput: { txHash: cell.out_point.tx_hash, index: BigInt(cell.out_point.index) },
        })),
      ],
      outputs: [
        { capacity: intent.amount, lock: intent.destinationLock },
        { capacity: feeInputs.capacity, lock: signerLock },
      ],
      outputsData: ['0x', '0x'],
      changeIndex: 1,
      fixedOutputCapacity: intent.amount,
      inputCapacity: intent.amount + feeInputs.capacity,
      cellDeps: [intent.contractCellDep],
    });
  }
}

export function createCkbSignerProvider(railConfig: CkbRailConfig): CkbSignerProvider {
  if (config.ckbSignerMode === 'local_dev') {
    return new LocalDevCkbSignerProvider(railConfig, config.ckbSignerPrivateKey);
  }
  throw invalidRequest('Configured external CKB signer provider is unavailable.', 'ckb_signer_unavailable');
}
