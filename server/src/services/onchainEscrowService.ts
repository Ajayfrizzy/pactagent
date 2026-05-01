import { Address, ClientPublicMainnet, ClientPublicTestnet } from '@ckb-ccc/core';
import { config, requireConfig } from '../config';

function getClient() {
  return config.ckbNetwork === 'mainnet'
    ? new ClientPublicMainnet({ url: config.ckbNodeUrl })
    : new ClientPublicTestnet({ url: config.ckbNodeUrl });
}

export function isOnchainEscrowReady() {
  return Boolean(
    config.onchainEscrowEnabled &&
      config.onchainLockCodeHash &&
      config.onchainLockHashType &&
      config.onchainLockTxHash &&
      config.onchainLockIndex
  );
}

async function lockHashFromAddress(address: string) {
  const client = getClient();
  const parsed = await Address.fromString(address, client);
  return parsed.script.hash();
}

function concatenateHex(parts: string[]) {
  return `0x${parts.map((part) => part.replace(/^0x/, '')).join('')}`;
}

export async function buildOnchainEscrowDescriptor(input: {
  agreementId: string;
  agreementDigest: string;
  clientAddress: string;
  workerAddress: string;
  arbitratorAddress: string;
}) {
  requireConfig(config.onchainLockCodeHash, 'ONCHAIN_LOCK_CODE_HASH');

  const client = getClient();
  const [clientLockHash, workerLockHash, arbitratorLockHash] = await Promise.all([
    lockHashFromAddress(input.clientAddress),
    lockHashFromAddress(input.workerAddress),
    lockHashFromAddress(input.arbitratorAddress),
  ]);

  const args = concatenateHex([
    clientLockHash,
    workerLockHash,
    arbitratorLockHash,
  ]);

  const script = {
    codeHash: config.onchainLockCodeHash,
    hashType: config.onchainLockHashType,
    args,
  };
  const address = Address.fromScript(script, client).toString();

  return {
    escrowAddress: address,
    lockCodeHash: config.onchainLockCodeHash,
    lockHashType: config.onchainLockHashType,
    lockArgs: args,
    clientLockHash,
    workerLockHash,
    arbitratorLockHash,
  };
}

export function getOnchainEscrowCellDep() {
  if (!isOnchainEscrowReady()) {
    return null;
  }

  return {
    outPoint: {
      txHash: config.onchainLockTxHash,
      index: config.onchainLockIndex,
    },
    depType: config.onchainLockDepType,
  };
}

export function buildMilestoneEscrowCellData(params: {
  agreementDigest: string;
  milestoneDigest: string;
  milestoneIndex: number;
  refundTimeoutBlock: number;
}) {
  const magic = '5041435445534331'; // PACTESC1
  const version = '01';
  const reserved = '000000';
  const milestoneIndex = params.milestoneIndex.toString(16).padStart(8, '0')
    .match(/../g)?.reverse().join('') || '00000000';
  const refundTimeout = BigInt(params.refundTimeoutBlock)
    .toString(16)
    .padStart(16, '0')
    .match(/../g)?.reverse().join('') || '0000000000000000';

  return `0x${magic}${version}${reserved}${milestoneIndex}${refundTimeout}${params.agreementDigest.replace(/^0x/, '')}${params.milestoneDigest.replace(/^0x/, '')}`;
}
