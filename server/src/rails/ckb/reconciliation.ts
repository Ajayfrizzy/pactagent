import { invalidRequest } from '../../common/errors/app-error';
import { scriptsEqual } from './script-utils';
import type { CkbRailConfig } from './network-config';
import { CkbNodeRpcClient } from './rpc';

export type CkbTransactionObservation = {
  status: 'pending' | 'committed' | 'confirmed' | 'rejected' | 'unknown';
  confirmations: number;
  blockHash: string | null;
  blockNumber: string | null;
  reason: string | null;
};

export class CkbReconciliationService {
  constructor(
    private readonly railConfig: CkbRailConfig,
    private readonly node: CkbNodeRpcClient,
  ) {}

  async observeTransaction(txHash: string): Promise<CkbTransactionObservation> {
    const response = await this.node.getTransaction(txHash);
    if (!response) {
      return { status: 'unknown', confirmations: 0, blockHash: null, blockNumber: null, reason: null };
    }
    if (response.tx_status.status === 'rejected') {
      return {
        status: 'rejected',
        confirmations: 0,
        blockHash: response.tx_status.block_hash ?? null,
        blockNumber: response.tx_status.block_number ? BigInt(response.tx_status.block_number).toString() : null,
        reason: response.tx_status.reason ?? null,
      };
    }
    if (response.tx_status.status !== 'committed' || !response.tx_status.block_number) {
      return { status: 'pending', confirmations: 0, blockHash: null, blockNumber: null, reason: null };
    }
    const tip = await this.node.getTipHeader();
    const blockNumber = BigInt(response.tx_status.block_number);
    const confirmations = Number(BigInt(tip.number) - blockNumber + BigInt(1));
    return {
      status: confirmations >= this.railConfig.confirmations ? 'confirmed' : 'committed',
      confirmations: Math.max(0, confirmations),
      blockHash: response.tx_status.block_hash ?? null,
      blockNumber: blockNumber.toString(),
      reason: null,
    };
  }

  async verifyFunding(input: {
    txHash: string;
    outputIndex: number;
    lockScript: unknown;
    cellData: string;
    amount: string;
  }) {
    const response = await this.node.getTransaction(input.txHash);
    if (!response?.transaction) {
      throw invalidRequest('Funding transaction was not found on the configured CKB network.', 'ckb_funding_not_found');
    }
    const output = response.transaction.outputs[input.outputIndex];
    const outputData = response.transaction.outputs_data[input.outputIndex];
    if (!output || !scriptsEqual(output.lock, input.lockScript) || outputData?.toLowerCase() !== input.cellData.toLowerCase()) {
      throw invalidRequest('Funding output does not match the persisted escrow commitment.', 'ckb_funding_mismatch');
    }
    if (BigInt(output.capacity) !== BigInt(input.amount)) {
      throw invalidRequest('Funding output capacity does not exactly match the escrow amount.', 'ckb_funding_amount_mismatch');
    }
    return this.observeTransaction(input.txHash);
  }

  async verifySettlement(input: {
    txHash: string;
    lockTxHash: string;
    lockOutputIndex: number;
    destinationLockScript: unknown;
    amount: string;
  }) {
    const response = await this.node.getTransaction(input.txHash);
    if (!response?.transaction) {
      throw invalidRequest('Settlement transaction was not found on the configured CKB network.', 'ckb_settlement_not_found');
    }
    const matchingInputs = response.transaction.inputs.filter((cellInput) => (
      cellInput.previous_output.tx_hash.toLowerCase() === input.lockTxHash.toLowerCase()
      && BigInt(cellInput.previous_output.index) === BigInt(input.lockOutputIndex)
    ));
    if (matchingInputs.length !== 1) {
      throw invalidRequest('Settlement transaction does not spend exactly the persisted escrow outpoint.', 'ckb_settlement_input_mismatch');
    }
    const matchingOutputs = response.transaction.outputs.filter((output) => (
      scriptsEqual(output.lock, input.destinationLockScript)
      && BigInt(output.capacity) === BigInt(input.amount)
    ));
    if (matchingOutputs.length !== 1) {
      throw invalidRequest('Settlement transaction must contain one exact escrow destination output.', 'ckb_settlement_output_mismatch');
    }
    return this.observeTransaction(input.txHash);
  }
}
