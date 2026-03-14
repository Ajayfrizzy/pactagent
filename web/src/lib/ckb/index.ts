import { ccc } from '@ckb-ccc/connector-react';

const CKB_DECIMALS = BigInt(10 ** 8);

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
}) {
  const tx = ccc.Transaction.from({});
  const recipient = await ccc.Address.fromString(params.toAddress, params.signer.client);

  tx.addOutput({
    lock: recipient.script,
    capacity: BigInt(params.amount),
  });

  await tx.completeFeeBy(params.signer);
  return params.signer.sendTransaction(tx);
}
