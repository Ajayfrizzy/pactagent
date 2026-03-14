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

export async function getTreasuryAddress() {
  if (config.treasuryAddress) {
    return config.treasuryAddress;
  }

  return getTreasurySigner().getRecommendedAddress();
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
