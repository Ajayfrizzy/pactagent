import { hashCkb, Script, type ScriptLike } from '@ckb-ccc/core';
import { invalidRequest } from '../../common/errors/app-error';
import { parsePositiveIntegerAmount } from '../../common/amounts/integer-amount';
import { calculateOccupiedCapacity } from './capacity';
import {
  encodeEscrowCellData,
  encodeEscrowLockArgs,
  ESCROW_CELL_DATA_VERSION,
} from './escrow-codec';
import { normalizeScript, type NormalizedCkbScript } from './script-utils';
import type { CkbRailConfig } from './network-config';

const MAX_BLOCK_SINCE = (BigInt(1) << BigInt(56)) - BigInt(1);

function requiredScript(value: unknown, field: string) {
  const script = normalizeScript(value);
  if (!script) throw invalidRequest(`${field} must be a valid CKB lock script.`, 'invalid_ckb_script');
  return script;
}

function digest(parts: unknown[]) {
  return hashCkb(Buffer.from(JSON.stringify(parts)));
}

function parseRefundTimeoutSince(value: string) {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw invalidRequest('refundTimeoutSince must be an unsigned block-number since value.', 'invalid_ckb_since');
  }
  const since = BigInt(value);
  if (since > MAX_BLOCK_SINCE) {
    throw invalidRequest('refundTimeoutSince must use absolute block-number semantics.', 'invalid_ckb_since');
  }
  return since;
}

export type CkbEscrowCommitment = {
  lockScript: NormalizedCkbScript;
  clientLockScript: NormalizedCkbScript;
  workerLockScript: NormalizedCkbScript;
  cellData: string;
  contractVersion: number;
  refundTimeoutSince: string;
  amount: string;
  outputIndex: number;
};

export class CkbTransactionBuilder {
  constructor(private readonly railConfig: CkbRailConfig) {}

  createCommitment(input: {
    agreementId: string;
    milestoneId: string;
    milestoneIndex: number;
    amount: string;
    clientLockScript: unknown;
    workerLockScript: unknown;
    refundTimeoutSince: string;
  }): CkbEscrowCommitment {
    const amount = parsePositiveIntegerAmount(input.amount, 'amount');
    const clientLockScript = requiredScript(input.clientLockScript, 'clientLockScript');
    const workerLockScript = requiredScript(input.workerLockScript, 'workerLockScript');
    const refundTimeoutSince = parseRefundTimeoutSince(input.refundTimeoutSince);
    const lockArgs = encodeEscrowLockArgs({
      clientLockHash: Script.from(clientLockScript).hash(),
      workerLockHash: Script.from(workerLockScript).hash(),
      agreementSalt: digest(['pactagent', 'agreement-salt', input.agreementId]),
    });
    const lockScript: NormalizedCkbScript = {
      codeHash: this.railConfig.contract.codeHash,
      hashType: this.railConfig.contract.hashType,
      args: lockArgs,
    };
    const cellData = encodeEscrowCellData({
      milestoneIndex: input.milestoneIndex,
      refundTimeoutSince,
      agreementDigest: digest(['pactagent', 'agreement', input.agreementId]),
      milestoneDigest: digest(['pactagent', 'milestone', input.agreementId, input.milestoneId, input.amount]),
    });
    const occupied = calculateOccupiedCapacity({ lock: lockScript }, cellData);
    if (amount < occupied) {
      throw invalidRequest(
        `Escrow amount is below occupied capacity (${occupied.toString()} shannons).`,
        'ckb_occupied_capacity_too_low',
      );
    }
    return {
      lockScript,
      clientLockScript,
      workerLockScript,
      cellData,
      contractVersion: ESCROW_CELL_DATA_VERSION,
      refundTimeoutSince: refundTimeoutSince.toString(),
      amount: amount.toString(),
      outputIndex: 0,
    };
  }

  createSettlementIntent(input: {
    operation: 'release' | 'refund';
    lockTxHash: string;
    lockOutputIndex: number;
    amount: string;
    clientLockScript: unknown;
    workerLockScript: unknown;
    refundTimeoutSince: string;
  }) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.lockTxHash)) {
      throw invalidRequest('Escrow lock transaction hash is invalid.', 'invalid_ckb_transaction');
    }
    return {
      operation: input.operation,
      escrowOutPoint: { txHash: input.lockTxHash.toLowerCase(), index: input.lockOutputIndex },
      amount: parsePositiveIntegerAmount(input.amount, 'amount'),
      destinationLock: requiredScript(
        input.operation === 'release' ? input.workerLockScript : input.clientLockScript,
        'destinationLockScript',
      ),
      authorizerLock: requiredScript(
        input.operation === 'release' ? input.clientLockScript : input.workerLockScript,
        'authorizerLockScript',
      ),
      since: input.operation === 'refund' ? parseRefundTimeoutSince(input.refundTimeoutSince) : BigInt(0),
    };
  }

  contractCellDep() {
    return {
      outPoint: {
        txHash: this.railConfig.contract.deploymentTxHash,
        index: this.railConfig.contract.outputIndex,
      },
      depType: this.railConfig.contract.depType,
    };
  }
}

export type { ScriptLike };
