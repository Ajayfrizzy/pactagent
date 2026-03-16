import { ccc } from '@ckb-ccc/connector-react';

const CKB_DECIMALS = BigInt(10 ** 8);

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
 * Rejects with a clear message if the signer is dormant.
 */
export async function checkSignerAlive(signer: ccc.Signer): Promise<void> {
  await withTimeout(
    signer.getRecommendedAddress(),
    5_000,
    'Your wallet extension is not responding. Please disconnect your wallet, refresh the page, and reconnect before funding.',
  );
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
      await withTimeout(
        tx.completeFeeBy(signer),
        15_000,
        'Your wallet is not responding. Please disconnect your wallet, refresh the page, reconnect, and try funding again.',
      );

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
