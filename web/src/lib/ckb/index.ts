import { ccc } from '@ckb-ccc/connector-react';

const CKB_DECIMALS = BigInt(10 ** 8);
const AVERAGE_CKB_BLOCK_MS = 8_000;

/** CKB requires a minimum of 61 CKB per output cell. */
export const MIN_CELL_CAPACITY = BigInt(61) * BigInt(10 ** 8); // 6_100_000_000 shannons

/**
 * Race a promise against a timeout. If the timeout fires first the returned
 * promise rejects with `message`. The timer is always cleaned up.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() =>
    clearTimeout(timeoutId),
  );
}

export function ckbToShannons(ckb: string): bigint {
  const parts = ckb.split('.');
  const whole = BigInt(parts[0] || '0') * CKB_DECIMALS;
  if (parts[1]) {
    const decimals = parts[1].padEnd(8, '0').slice(0, 8);
    return whole + BigInt(decimals);
  }
  return whole;
}

export function shannonsToCKB(shannons: string): string {
  const val = BigInt(shannons);
  const whole = val / CKB_DECIMALS;
  const frac = val % CKB_DECIMALS;
  if (frac === BigInt(0)) {
    return whole.toString();
  }
  return `${whole}.${frac.toString().padStart(8, '0').replace(/0+$/, '')}`;
}

export function getCkbClient() {
  const network = process.env.NEXT_PUBLIC_CKB_NETWORK || 'testnet';
  const url = process.env.NEXT_PUBLIC_CKB_NODE_URL;

  return network === 'mainnet'
    ? new ccc.ClientPublicMainnet(url ? { url } : undefined)
    : new ccc.ClientPublicTestnet(url ? { url } : undefined);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, canonicalize(nestedValue)])
    );
  }

  return value;
}

async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toLittleEndianHex(value: bigint, byteLength: number) {
  const padded = value.toString(16).padStart(byteLength * 2, '0');
  const pairs = padded.match(/../g) || [];
  return pairs.reverse().join('');
}

export async function buildSingleMilestoneDigestForEscrow(milestone: {
  title: string;
  description: string;
  amount: string;
  sortOrder: number;
}) {
  const payload = JSON.stringify(canonicalize({
    milestones: [
      {
        sortOrder: milestone.sortOrder,
        title: milestone.title.trim(),
        description: milestone.description.trim(),
        amount: milestone.amount,
      },
    ],
  }));

  return sha256Hex(payload);
}

export function buildMilestoneEscrowCellData(params: {
  agreementDigest: string;
  milestoneDigest: string;
  milestoneIndex: number;
  refundTimeoutBlock: bigint;
}) {
  const magic = '5041435445534331';
  const version = '01';
  const reserved = '000000';
  const milestoneIndex = toLittleEndianHex(BigInt(params.milestoneIndex), 4);
  const refundTimeout = toLittleEndianHex(params.refundTimeoutBlock, 8);

  return `0x${magic}${version}${reserved}${milestoneIndex}${refundTimeout}${params.agreementDigest.replace(/^0x/, '')}${params.milestoneDigest.replace(/^0x/, '')}`;
}

function getEscrowLockScript(agreement: {
  escrowLockCodeHash?: string | null;
  escrowLockHashType?: string | null;
  escrowLockArgs?: string | null;
}) {
  if (!agreement.escrowLockCodeHash || !agreement.escrowLockHashType || !agreement.escrowLockArgs) {
    throw new Error('On-chain escrow lock metadata is incomplete for this agreement.');
  }

  return {
    codeHash: agreement.escrowLockCodeHash,
    hashType: agreement.escrowLockHashType,
    args: agreement.escrowLockArgs,
  };
}

function getEscrowCellDep(config: {
  onchainLockTxHash?: string | null;
  onchainLockIndex?: string | null;
  onchainLockDepType?: 'code' | 'depGroup' | null;
}) {
  if (!config.onchainLockTxHash || !config.onchainLockIndex || !config.onchainLockDepType) {
    throw new Error('On-chain escrow deployment metadata is missing from server config.');
  }

  return {
    outPoint: {
      txHash: config.onchainLockTxHash,
      index: config.onchainLockIndex,
    },
    depType: config.onchainLockDepType,
  };
}

export async function sendOnchainEscrowFunding(params: {
  signer: ccc.Signer;
  agreement: {
    agreementDigest: string;
    deadlineAt: string;
    milestones: Array<{
      id: string;
      title: string;
      description: string;
      amount: string;
      sortOrder: number;
    }>;
    escrowLockCodeHash?: string | null;
    escrowLockHashType?: string | null;
    escrowLockArgs?: string | null;
  };
  onProgress?: (step: string) => void;
}) {
  const { signer, agreement, onProgress = () => {} } = params;
  const escrowScript = getEscrowLockScript(agreement);
  const tx = ccc.Transaction.from({});

  onProgress('Checking wallet connection...');
  await checkSignerAlive(signer);

  const currentTip = await signer.client.getTip();
  const deadlineMs = new Date(agreement.deadlineAt).getTime();
  const blocksUntilDeadline = Math.max(1, Math.ceil((deadlineMs - Date.now()) / AVERAGE_CKB_BLOCK_MS));
  const refundTimeoutBlock = currentTip + BigInt(blocksUntilDeadline);

  const milestoneOutputs: Array<{
    milestoneId: string;
    outputIndex: number;
    escrowCellData: string;
    refundTimeoutBlock: string;
  }> = [];

  onProgress('Preparing escrow cells...');
  for (const milestone of agreement.milestones) {
    const milestoneDigest = await buildSingleMilestoneDigestForEscrow({
      title: milestone.title,
      description: milestone.description,
      amount: milestone.amount,
      sortOrder: milestone.sortOrder,
    });
    const escrowCellData = buildMilestoneEscrowCellData({
      agreementDigest: agreement.agreementDigest,
      milestoneDigest,
      milestoneIndex: milestone.sortOrder,
      refundTimeoutBlock,
    });

    const outputIndex = tx.addOutput({
      lock: escrowScript,
      capacity: BigInt(milestone.amount),
    }, escrowCellData);

    milestoneOutputs.push({
      milestoneId: milestone.id,
      outputIndex,
      escrowCellData,
      refundTimeoutBlock: refundTimeoutBlock.toString(),
    });
  }

  onProgress('Calculating fees...');
  await tx.completeFeeBy(signer);

  onProgress('Waiting for wallet approval...');
  const txHash = await signer.sendTransaction(tx);

  return {
    txHash: String(txHash),
    milestoneOutputs,
  };
}

export async function sendOnchainEscrowResolution(params: {
  signer: ccc.Signer;
  agreement: {
    workerAddress: string;
    clientAddress: string;
    escrowLockCodeHash?: string | null;
    escrowLockHashType?: string | null;
    escrowLockArgs?: string | null;
  };
  milestone: {
    amount: string;
    escrowFundingTxHash?: string | null;
    escrowOutputIndex?: number | null;
    escrowCellData?: string | null;
    refundTimeoutBlock?: string | null;
  };
  config: {
    onchainLockTxHash?: string | null;
    onchainLockIndex?: string | null;
    onchainLockDepType?: 'code' | 'depGroup' | null;
  };
  direction: 'PAYOUT' | 'REFUND';
  useTimeout?: boolean;
  onProgress?: (step: string) => void;
}) {
  const { signer, agreement, milestone, config, direction, useTimeout = false, onProgress = () => {} } = params;
  if (milestone.escrowOutputIndex == null || !milestone.escrowFundingTxHash) {
    throw new Error('Escrow cell metadata is missing for this milestone.');
  }

  onProgress('Loading escrow cell...');
  const escrowCell = await signer.client.getCell({
    txHash: milestone.escrowFundingTxHash,
    index: milestone.escrowOutputIndex,
  });

  if (!escrowCell) {
    throw new Error('Could not find the escrow cell on-chain for this milestone.');
  }

  const tx = ccc.Transaction.from({});
  tx.addCellDeps(getEscrowCellDep(config));

  tx.addInput({
    previousOutput: escrowCell.outPoint,
    since: direction === 'REFUND' && useTimeout
      ? BigInt(milestone.refundTimeoutBlock || '0')
      : BigInt(0),
    cellOutput: escrowCell.cellOutput,
    outputData: escrowCell.outputData,
  });

  const recipientAddress = direction === 'PAYOUT'
    ? agreement.workerAddress
    : agreement.clientAddress;
  const recipient = await ccc.Address.fromString(recipientAddress, signer.client);

  tx.addOutput({
    lock: recipient.script,
    capacity: BigInt(milestone.amount),
  });

  onProgress('Adding fee-paying signer input...');
  await tx.completeFeeBy(signer);

  onProgress('Waiting for wallet approval...');
  const txHash = await signer.sendTransaction(tx);
  return String(txHash);
}

async function withPinnedSignerAddress<T>(
  signer: ccc.Signer,
  fromAddress: string,
  run: (signer: ccc.Signer) => Promise<T>,
): Promise<T> {
  const pinnedAddress = await ccc.Address.fromString(fromAddress, signer.client);
  const normalizedAddress = pinnedAddress.toString();
  const signerWithOverrides = signer as ccc.Signer & Record<string, unknown>;
  const overrides: Record<string, unknown> = {};

  const setOverride = (key: string, value: unknown) => {
    overrides[key] = signerWithOverrides[key];
    signerWithOverrides[key] = value;
  };

  setOverride('getInternalAddress', async () => normalizedAddress);
  setOverride('getRecommendedAddress', async () => normalizedAddress);
  setOverride('getAddressObj', async () => pinnedAddress);
  setOverride('getAddressObjs', async () => [pinnedAddress]);
  setOverride('getRecommendedAddressObj', async () => pinnedAddress);

  try {
    return await run(signer);
  } finally {
    for (const key of Object.keys(overrides)) {
      const value = overrides[key];
      if (value === undefined) {
        delete signerWithOverrides[key];
      } else {
        signerWithOverrides[key] = value;
      }
    }
  }
}

/**
 * Quick probe to verify the wallet extension is still responsive.
 * Tries twice (the first attempt may wake a dormant service worker).
 * Rejects with a clear message if the signer is unresponsive.
 */
export async function checkSignerAlive(signer: ccc.Signer): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await withTimeout(
        signer.getRecommendedAddress(),
        8_000,
        'TIMEOUT',
      );
      return; // success
    } catch (err) {
      if (attempt === 0 && err instanceof Error && err.message === 'TIMEOUT') {
        // First attempt timed out — the wallet background worker may be waking up. Retry once.
        continue;
      }
      throw new Error(
        'Your wallet extension is not responding. Please click "Disconnect", then reconnect your wallet and try again.',
      );
    }
  }
}

export async function sendCapacityTransfer(params: {
  signer: ccc.Signer;
  fromAddress: string;
  toAddress: string;
  amount: string;
  onProgress?: (step: string) => void;
}): Promise<string> {
  const { onProgress = () => {} } = params;

  // Validate minimum cell capacity upfront
  const amountBig = BigInt(params.amount);
  if (amountBig < MIN_CELL_CAPACITY) {
    throw new Error(
      `Agreement amount is below the CKB minimum of 61 CKB. Each output cell requires at least 61 CKB (${MIN_CELL_CAPACITY.toString()} shannons).`,
    );
  }

  onProgress('Checking wallet connection...');
  await checkSignerAlive(params.signer);

  // Check on-chain balance before attempting the transaction
  onProgress('Checking wallet balance...');
  let balance: bigint;
  try {
    balance = await withTimeout(
      params.signer.getBalance(),
      10_000,
      'Could not fetch your wallet balance. The CKB node may be unreachable — please try again later.',
    );
  } catch (err) {
    throw err instanceof Error ? err : new Error('Failed to check wallet balance.');
  }

  // Need amount + at least some extra for fees (roughly 0.01 CKB / 1_000_000 shannons is safe)
  const FEE_BUFFER = BigInt(1_000_000);
  if (balance < amountBig + FEE_BUFFER) {
    const balanceCKB = `${balance / BigInt(10 ** 8)}.${(balance % BigInt(10 ** 8)).toString().padStart(8, '0').replace(/0+$/, '') || '0'}`;
    const requiredCKB = `${amountBig / BigInt(10 ** 8)}.${(amountBig % BigInt(10 ** 8)).toString().padStart(8, '0').replace(/0+$/, '') || '0'}`;
    throw new Error(
      `Insufficient CKB balance. Your wallet has ${balanceCKB} CKB but this agreement requires ${requiredCKB} CKB plus fees. Please fund your wallet on CKB testnet first.`,
    );
  }

  onProgress('Preparing transaction...');
  return withPinnedSignerAddress(
    params.signer,
    params.fromAddress,
    async (signer) => {
      const tx = ccc.Transaction.from({});
      const recipient = await withTimeout(
        ccc.Address.fromString(params.toAddress, signer.client),
        10_000,
        'Could not resolve the treasury address. The CKB node may be unreachable — please try again.',
      );

      tx.addOutput({
        lock: recipient.script,
        capacity: amountBig,
      });

      onProgress('Calculating fees — waiting for wallet...');
      try {
        await withTimeout(
          tx.completeFeeBy(signer),
          15_000,
          'Timed out while calculating transaction fees. Please disconnect your wallet, refresh the page, reconnect, and try funding again.',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Timed out')) throw err;
        throw new Error(`Failed to build the transaction: ${msg}. Make sure your wallet has enough CKB and try again.`);
      }

      onProgress('Waiting for wallet approval — check your wallet popup...');
      const txHash = await withTimeout(
        signer.sendTransaction(tx),
        120_000,
        'Timed out waiting for wallet approval. Please check your wallet extension for a pending approval popup and try again.',
      );

      return String(txHash);
    },
  );
}
