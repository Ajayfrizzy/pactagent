import {
  Address,
  ClientPublicMainnet,
  ClientPublicTestnet,
} from '@ckb-ccc/core';
import { config } from '../config';
import { getTreasurySignerProvider } from './treasurySignerProvider';
import { assertProviderResponse, executeProviderRequest } from '../common/resilience/provider';

function getClient() {
  return config.ckbNetwork === 'mainnet'
    ? new ClientPublicMainnet({ url: config.ckbNodeUrl })
    : new ClientPublicTestnet({ url: config.ckbNodeUrl });
}

type CkbTxStatus = 'pending' | 'proposed' | 'committed' | 'rejected' | 'unknown';

type CkbTransactionResponse = {
  transaction?: {
    inputs?: Array<{
      previous_output?: Record<string, string | undefined>;
      previousOutput?: Record<string, string | undefined>;
    }>;
    outputs?: Array<{
      capacity?: string;
      lock?: unknown;
    }>;
    outputs_data?: string[];
    outputsData?: string[];
  } | null;
  tx_status?: {
    status?: CkbTxStatus;
    block_hash?: string | null;
  } | null;
} | null;

function parseCapacity(value: string | undefined): bigint {
  if (!value) {
    return BigInt(0);
  }

  if (value.startsWith('0x') || value.startsWith('0X')) {
    return BigInt(value);
  }

  return BigInt(value);
}

type NormalizedScript = {
  codeHash: string;
  hashType: string;
  args: string;
};

function normalizeHex(value: string | undefined) {
  return (value || '').toLowerCase();
}

function normalizeScript(script: unknown): NormalizedScript | null {
  if (!script || typeof script !== 'object') {
    return null;
  }

  const maybeScript = script as Record<string, unknown>;
  const codeHash = maybeScript.codeHash ?? maybeScript.code_hash;
  const hashType = maybeScript.hashType ?? maybeScript.hash_type;
  const args = maybeScript.args;

  if (
    typeof codeHash !== 'string' ||
    typeof hashType !== 'string' ||
    typeof args !== 'string'
  ) {
    return null;
  }

  return {
    codeHash: normalizeHex(codeHash),
    hashType: hashType.toLowerCase(),
    args: normalizeHex(args),
  };
}

export function scriptsEqual(left: unknown, right: unknown) {
  const normalizedLeft = normalizeScript(left);
  const normalizedRight = normalizeScript(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return (
    normalizedLeft.codeHash === normalizedRight.codeHash &&
    normalizedLeft.hashType === normalizedRight.hashType &&
    normalizedLeft.args === normalizedRight.args
  );
}

async function rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await executeProviderRequest({
    provider: 'ckb', operation: method, timeoutMs: 15_000,
    run: async ({ signal, requestId }) => {
      const result = await fetch(config.ckbNodeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': requestId,
    },
    body: JSON.stringify({
      id: Date.now(),
      jsonrpc: '2.0',
      method,
      params,
    }),
        signal,
      });
      assertProviderResponse(result, 'ckb', requestId);
      return result;
    },
  });

  const data = await response.json() as {
    result?: T;
    error?: { code: number; message: string };
  };

  if (data.error) {
    throw new Error(`CKB RPC error [${data.error.code}]: ${data.error.message}`);
  }

  return data.result as T;
}

async function getDerivedTreasuryAddress() {
  return getTreasurySignerProvider().getAddress();
}

export async function getTreasuryAddress() {
  const derivedAddress = await getDerivedTreasuryAddress();
  const configuredAddress = config.treasuryAddress.trim();

  if (!configuredAddress) {
    return derivedAddress;
  }

  try {
    const client = getClient();
    const configured = await Address.fromString(configuredAddress, client);
    const derived = await Address.fromString(derivedAddress, client);

    if (JSON.stringify(configured.script) === JSON.stringify(derived.script)) {
      return configuredAddress;
    }

    console.warn(
      `[CKB] Configured TREASURY_CKB_ADDRESS does not match the treasury signer. Falling back to derived address ${derivedAddress}.`
    );
    return derivedAddress;
  } catch (error) {
    console.warn(
      `[CKB] Failed to parse configured TREASURY_CKB_ADDRESS. Falling back to derived address ${derivedAddress}.`,
      error
    );
    return derivedAddress;
  }
}

export async function verifyFundingTransaction(params: {
  txHash: string;
  toAddress: string;
  expectedAmount: string;
}) {
  const client = getClient();
  const targetAddress = await Address.fromString(params.toAddress, client);
  const tx = await rpcCall<CkbTransactionResponse>('get_transaction', [params.txHash]);
  const outputs = tx?.transaction?.outputs ?? [];
  const matchingOutput = outputs.find((output) => {
    if (!output?.lock) {
      return false;
    }

    return (
      scriptsEqual(output.lock, targetAddress.script) &&
      parseCapacity(output.capacity) >= BigInt(params.expectedAmount)
    );
  });

  return {
    foundTransaction: Boolean(tx?.transaction),
    foundMatchingOutput: Boolean(matchingOutput),
    status: tx?.tx_status?.status ?? ('unknown' as CkbTxStatus),
    blockHash: tx?.tx_status?.block_hash ?? null,
  };
}

export async function inspectTransactionOutputsToAddress(params: {
  txHash: string;
  toAddress: string;
}) {
  const client = getClient();
  const targetAddress = await Address.fromString(params.toAddress, client);
  const tx = await rpcCall<CkbTransactionResponse>('get_transaction', [params.txHash]);
  const outputs = tx?.transaction?.outputs ?? [];
  const outputsData = tx?.transaction?.outputs_data ?? tx?.transaction?.outputsData ?? [];

  const matchingOutputs = outputs
    .map((output, index) => ({ output, index }))
    .filter(({ output }) => output?.lock && scriptsEqual(output.lock, targetAddress.script))
    .map(({ output, index }) => ({
      index,
      capacity: parseCapacity(output.capacity),
      outputData: outputsData[index] || null,
    }));

  return {
    foundTransaction: Boolean(tx?.transaction),
    status: tx?.tx_status?.status ?? ('unknown' as CkbTxStatus),
    blockHash: tx?.tx_status?.block_hash ?? null,
    matchingOutputs,
    totalMatchedCapacity: matchingOutputs.reduce((sum, item) => sum + item.capacity, BigInt(0)),
  };
}

export async function inspectTransactionOutputsToScript(params: {
  txHash: string;
  script: {
    codeHash: string;
    hashType: string;
    args: string;
  };
}) {
  const tx = await rpcCall<CkbTransactionResponse>('get_transaction', [params.txHash]);
  const outputs = tx?.transaction?.outputs ?? [];
  const outputsData = tx?.transaction?.outputs_data ?? tx?.transaction?.outputsData ?? [];

  const matchingOutputs = outputs
    .map((output, index) => ({ output, index }))
    .filter(({ output }) => output?.lock && scriptsEqual(output.lock, params.script))
    .map(({ output, index }) => ({
      index,
      capacity: parseCapacity(output.capacity),
      outputData: outputsData[index] || null,
    }));

  return {
    foundTransaction: Boolean(tx?.transaction),
    status: tx?.tx_status?.status ?? ('unknown' as CkbTxStatus),
    blockHash: tx?.tx_status?.block_hash ?? null,
    matchingOutputs,
    totalMatchedCapacity: matchingOutputs.reduce((sum, item) => sum + item.capacity, BigInt(0)),
  };
}

export async function findSpendingTransactionForOutPoint(params: {
  txHash: string;
  index: number;
}) {
  const tx = await rpcCall<CkbTransactionResponse>('get_transaction', [params.txHash]);
  if (!tx?.transaction?.outputs?.length) {
    return {
      foundTransaction: false,
      spendingTxHash: null,
    };
  }

  const output = tx.transaction.outputs[params.index];
  if (!output?.lock) {
    return {
      foundTransaction: true,
      spendingTxHash: null,
    };
  }

  const searchKey = {
    script: output.lock,
    script_type: 'lock',
  };

  const matches = await rpcCall<{
    objects?: Array<{
      tx_hash?: string;
      txHash?: string;
      io_type?: string;
      ioType?: string;
    }>;
  }>('get_transactions', [searchKey, 'desc', '0x40', null]);

  const spendingHashes = new Set(
    (matches.objects || [])
      .filter((entry) => (entry.io_type ?? entry.ioType) === 'input')
      .map((entry) => entry.tx_hash ?? entry.txHash)
      .filter((value): value is string => Boolean(value) && value !== params.txHash)
  );

  for (const candidateHash of spendingHashes) {
    const candidateTx = await rpcCall<CkbTransactionResponse>('get_transaction', [candidateHash]);
    const inputs = candidateTx?.transaction?.inputs ?? [];
    const spendsOutPoint = inputs.some((input) => {
      const previousOutput = (input.previous_output ?? input.previousOutput) as Record<string, string | undefined> | undefined;
      const previousTxHash = previousOutput?.tx_hash ?? previousOutput?.txHash;
      const previousIndex = previousOutput?.index;
      if (!previousTxHash || previousIndex == null) {
        return false;
      }

      return (
        normalizeHex(previousTxHash) === normalizeHex(params.txHash)
        && parseCapacity(previousIndex) === BigInt(params.index)
      );
    });

    if (spendsOutPoint) {
      return {
        foundTransaction: true,
        spendingTxHash: candidateHash,
      };
    }
  }

  return {
    foundTransaction: true,
    spendingTxHash: null,
  };
}

export async function sendTreasuryTransfer(toAddress: string, amount: string) {
  return getTreasurySignerProvider().sendTransfer(toAddress, amount);
}
