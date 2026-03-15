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
