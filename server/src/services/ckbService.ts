import {
  Address,
  ClientPublicMainnet,
  ClientPublicTestnet,
  SignerCkbPrivateKey,
  Transaction,
} from '@ckb-ccc/core';
import { config, requireConfig } from '../config';

function getClient() {
  return config.ckbNetwork === 'mainnet'
    ? new ClientPublicMainnet({ url: config.ckbNodeUrl })
    : new ClientPublicTestnet({ url: config.ckbNodeUrl });
}

function getTreasurySigner() {
  return new SignerCkbPrivateKey(
    getClient(),
    requireConfig(config.treasuryPrivateKey, 'TREASURY_CKB_PRIVATE_KEY')
  );
}

type CkbTxStatus = 'pending' | 'proposed' | 'committed' | 'rejected' | 'unknown';

type CkbTransactionResponse = {
  transaction?: {
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
  const response = await fetch(config.ckbNodeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: Date.now(),
      jsonrpc: '2.0',
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`CKB RPC HTTP error: ${response.status} ${response.statusText}`);
  }

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
  const signer = getTreasurySigner();
  return String(await signer.getRecommendedAddress());
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
      `[CKB] Configured TREASURY_CKB_ADDRESS does not match TREASURY_CKB_PRIVATE_KEY. Falling back to derived address ${derivedAddress}.`
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

export async function sendTreasuryTransfer(toAddress: string, amount: string) {
  const signer = getTreasurySigner();
  const tx = Transaction.from({});
  const to = await Address.fromString(toAddress, signer.client);

  tx.addOutput({
    lock: to.script,
    capacity: BigInt(amount),
  });

  await tx.completeFeeBy(signer, BigInt(config.defaultCkbFeeRate));
  return signer.sendTransaction(tx);
}
