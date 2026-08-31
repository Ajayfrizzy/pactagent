import { invalidRequest } from '../../../common/errors/app-error';
import { getCkbRailConfig } from '../../../rails/ckb/network-config';
import { CkbNodeRpcClient } from '../../../rails/ckb/rpc';
import { CkbReconciliationService } from '../../../rails/ckb/reconciliation';
import { createCkbSignerProvider, type CkbSignerProvider } from '../../../rails/ckb/signer-provider';
import { CkbTransactionBuilder } from '../../../rails/ckb/transaction-builder';
import type {
  EscrowAdapter,
  EscrowAdapterContext,
  EscrowAdapterCreateInput,
  EscrowAdapterResult,
} from './escrow-adapter.interface';

export class CkbEscrowAdapter implements EscrowAdapter {
  private readonly railConfig;
  private readonly node;
  private readonly builder;
  private signer?: CkbSignerProvider;
  private readonly reconciliation;

  constructor(dependencies?: {
    signer?: CkbSignerProvider;
    node?: CkbNodeRpcClient;
  }) {
    this.railConfig = getCkbRailConfig();
    this.node = dependencies?.node ?? new CkbNodeRpcClient(this.railConfig.nodeUrl);
    this.builder = new CkbTransactionBuilder(this.railConfig);
    this.signer = dependencies?.signer;
    this.reconciliation = new CkbReconciliationService(this.railConfig, this.node);
  }

  private requireSigner() {
    if (!this.signer) {
      if (!this.railConfig.enabled) {
        throw invalidRequest('CKB rail is disabled.', 'escrow_adapter_not_ready');
      }
      this.signer = createCkbSignerProvider(this.railConfig);
    }
    return this.signer;
  }

  private assertNetwork(network: string) {
    if (network !== this.railConfig.network) {
      throw invalidRequest(
        `CKB escrow network ${network} does not match configured network ${this.railConfig.network}.`,
        'ckb_network_mismatch',
      );
    }
  }

  private requiredContext(input: EscrowAdapterContext) {
    if (
      !input.lockTxHash
      || input.lockOutputIndex === null
      || input.lockOutputIndex === undefined
      || !input.lockScriptJson
      || !input.clientLockScriptJson
      || !input.workerLockScriptJson
      || !input.cellData
      || !input.refundTimeoutSince
    ) {
      throw invalidRequest('Persisted CKB escrow commitment is incomplete.', 'ckb_escrow_context_incomplete');
    }
    return {
      lockTxHash: input.lockTxHash,
      lockOutputIndex: input.lockOutputIndex,
      lockScript: JSON.parse(input.lockScriptJson) as unknown,
      clientLockScript: JSON.parse(input.clientLockScriptJson) as unknown,
      workerLockScript: JSON.parse(input.workerLockScriptJson) as unknown,
      cellData: input.cellData,
      refundTimeoutSince: input.refundTimeoutSince,
    };
  }

  async createEscrowLock(input: EscrowAdapterCreateInput): Promise<EscrowAdapterResult> {
    if (!this.railConfig.enabled) {
      throw invalidRequest('CKB rail is disabled.', 'escrow_adapter_not_ready');
    }
    this.assertNetwork(input.network);
    if (!input.milestoneId || !input.milestoneIndex || !input.refundTimeoutSince) {
      throw invalidRequest('CKB escrow requires milestone scope and timeout terms.', 'ckb_escrow_terms_required');
    }
    const commitment = this.builder.createCommitment({
      agreementId: input.agreementId,
      milestoneId: input.milestoneId,
      milestoneIndex: input.milestoneIndex,
      amount: input.amount,
      clientLockScript: input.clientLockScript,
      workerLockScript: input.workerLockScript,
      refundTimeoutSince: input.refundTimeoutSince,
    });
    const signed = await this.requireSigner().signEscrowLock(commitment);
    let status = 'awaiting_funding';
    let broadcastHash: string | null = null;
    let ambiguity: string | null = null;
    try {
      broadcastHash = await this.node.sendTransaction(signed.transaction);
      if (broadcastHash.toLowerCase() !== signed.txHash.toLowerCase()) {
        throw new Error('CKB node returned a different transaction hash.');
      }
    } catch (error) {
      status = 'reconciliation_required';
      ambiguity = error instanceof Error ? error.message : 'Ambiguous CKB broadcast result.';
    }
    return {
      status,
      txHash: broadcastHash ?? signed.txHash,
      lockOutputIndex: commitment.outputIndex,
      lockScript: commitment.lockScript,
      clientLockScript: commitment.clientLockScript,
      workerLockScript: commitment.workerLockScript,
      cellData: commitment.cellData,
      contractVersion: commitment.contractVersion,
      refundTimeoutSince: commitment.refundTimeoutSince,
      rawPayload: {
        operation: 'createEscrowLock',
        expectedTxHash: signed.txHash,
        broadcastAmbiguity: ambiguity,
      },
    };
  }

  async checkFundingStatus(input: EscrowAdapterContext): Promise<EscrowAdapterResult> {
    this.assertNetwork(input.network);
    const context = this.requiredContext(input);
    const observation = await this.reconciliation.verifyFunding({
      txHash: context.lockTxHash,
      outputIndex: context.lockOutputIndex,
      lockScript: context.lockScript,
      cellData: context.cellData,
      amount: input.amount,
    });
    return {
      status: observation.status === 'confirmed' ? 'funded' : 'funding_detected',
      txHash: context.lockTxHash,
      confirmations: observation.confirmations,
      blockHash: observation.blockHash,
      blockNumber: observation.blockNumber,
      rawPayload: observation,
    };
  }

  markFunded(input: EscrowAdapterContext & { txHash?: string | null }): Promise<EscrowAdapterResult> {
    if (input.txHash && input.lockTxHash && input.txHash.toLowerCase() !== input.lockTxHash.toLowerCase()) {
      throw invalidRequest('Funding transaction hint does not match the persisted lock transaction.', 'ckb_funding_mismatch');
    }
    return this.checkFundingStatus(input);
  }

  private async settle(operation: 'release' | 'refund', input: EscrowAdapterContext) {
    this.assertNetwork(input.network);
    const context = this.requiredContext(input);
    const intent = this.builder.createSettlementIntent({
      operation,
      lockTxHash: context.lockTxHash,
      lockOutputIndex: context.lockOutputIndex,
      amount: input.amount,
      clientLockScript: context.clientLockScript,
      workerLockScript: context.workerLockScript,
      refundTimeoutSince: context.refundTimeoutSince,
    });
    const signed = await this.requireSigner().signSettlement({
      ...intent,
      contractCellDep: this.builder.contractCellDep(),
    });
    try {
      const txHash = await this.node.sendTransaction(signed.transaction);
      return { status: `${operation}_pending`, txHash, rawPayload: { expectedTxHash: signed.txHash } };
    } catch (error) {
      return {
        status: 'reconciliation_required',
        txHash: signed.txHash,
        rawPayload: {
          expectedTxHash: signed.txHash,
          broadcastAmbiguity: error instanceof Error ? error.message : 'Ambiguous CKB broadcast result.',
        },
      };
    }
  }

  release(input: EscrowAdapterContext): Promise<EscrowAdapterResult> {
    return this.settle('release', input);
  }

  refund(input: EscrowAdapterContext): Promise<EscrowAdapterResult> {
    return this.settle('refund', input);
  }

  async checkSettlementStatus(input: EscrowAdapterContext & {
    operation: 'release' | 'refund';
    txHash: string;
  }): Promise<EscrowAdapterResult> {
    this.assertNetwork(input.network);
    const context = this.requiredContext(input);
    const observation = await this.reconciliation.verifySettlement({
      txHash: input.txHash,
      lockTxHash: context.lockTxHash,
      lockOutputIndex: context.lockOutputIndex,
      destinationLockScript: input.operation === 'release'
        ? context.workerLockScript
        : context.clientLockScript,
      amount: input.amount,
    });
    return {
      status: observation.status,
      txHash: input.txHash,
      confirmations: observation.confirmations,
      blockHash: observation.blockHash,
      blockNumber: observation.blockNumber,
      rawPayload: observation,
    };
  }

  async getTransactionStatus(input: { txHash: string }): Promise<EscrowAdapterResult> {
    const observation = await this.reconciliation.observeTransaction(input.txHash);
    return {
      status: observation.status,
      txHash: input.txHash,
      confirmations: observation.confirmations,
      blockHash: observation.blockHash,
      blockNumber: observation.blockNumber,
      rawPayload: observation,
    };
  }
}
