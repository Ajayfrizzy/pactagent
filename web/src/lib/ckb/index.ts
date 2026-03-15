import { ccc } from '@ckb-ccc/connector-react';

const CKB_DECIMALS = BigInt(10 ** 8);

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

export async function sendCapacityTransfer(params: {
  signer: ccc.Signer;
  toAddress: string;
  amount: string;
}): Promise<string> {
  const tx = ccc.Transaction.from({});
  const recipient = await ccc.Address.fromString(params.toAddress, params.signer.client);

  tx.addOutput({
    lock: recipient.script,
    capacity: BigInt(params.amount),
  });

  await withTimeout(
    tx.completeFeeBy(params.signer),
    60_000,
    'Your wallet is not responding. Please disconnect your wallet, refresh the page, reconnect, and try funding again.',
  );

  const txHash = await withTimeout(
    params.signer.sendTransaction(tx),
    120_000,
    'Timed out waiting for wallet approval. Please check your wallet extension for a pending approval popup and try again.',
  );

  return String(txHash);
}
